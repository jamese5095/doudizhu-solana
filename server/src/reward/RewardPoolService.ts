/**
 * RewardPoolService — 奖励池管理
 *
 * 职责：
 * 1. 管理 7 天奖励周期的创建与轮换
 * 2. 每局结算后累加手续费到当前周期
 * 3. 周期结束时按排行榜分数按比例分配奖励
 * 4. 处理玩家的奖励领取请求（通过 relay wallet 转账）
 */

import type { Pool } from 'pg';
import {
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { RewardCycle, RewardClaim } from '@doudizhu/types';
import {
  REWARD_CYCLE_SECS,
  REWARD_POOL_SHARE,
  MIN_CLAIM_AMOUNT,
} from '../lib/economy';

interface SolanaConnection {
  getLatestBlockhash(commitment?: string): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(raw: Buffer | Uint8Array, opts?: { skipPreflight?: boolean }): Promise<string>;
  confirmTransaction(
    info: { signature: string; blockhash: string; lastValidBlockHeight: number },
    commitment?: string,
  ): Promise<unknown>;
}

export class RewardPoolService {
  constructor(
    private readonly pool: Pool,
    private readonly connection: SolanaConnection,
    private readonly relayerKeypair: Keypair,
    private readonly mintAddress: PublicKey,
    private readonly treasuryAta: PublicKey,
    private readonly mintDecimals: number = 9,
  ) {}

  // ─── 周期管理 ──────────────────────────────────────────────────────────────

  /** 获取当前活跃周期，不存在则创建 */
  async getCurrentCycle(): Promise<RewardCycle> {
    const now = Math.floor(Date.now() / 1000);

    // 查找包含当前时间的活跃周期
    const { rows } = await this.pool.query<CycleRow>(
      `SELECT * FROM reward_cycles WHERE cycle_start <= $1 AND cycle_end > $1 LIMIT 1`,
      [now],
    );

    if (rows.length > 0) return this.toCycle(rows[0]);

    // 没有活跃周期，创建新周期
    return this.createCycle(now);
  }

  /** 创建新的奖励周期 */
  private async createCycle(now: number): Promise<RewardCycle> {
    const cycleStart = now;
    const cycleEnd   = now + REWARD_CYCLE_SECS;

    const { rows } = await this.pool.query<CycleRow>(
      `INSERT INTO reward_cycles (cycle_start, cycle_end)
       VALUES ($1, $2)
       ON CONFLICT (cycle_start) DO UPDATE SET cycle_start = EXCLUDED.cycle_start
       RETURNING *`,
      [cycleStart, cycleEnd],
    );

    return this.toCycle(rows[0]);
  }

  // ─── 手续费累加 ────────────────────────────────────────────────────────────

  /** 每局结算后调用：将手续费累加到当前周期 */
  async accumulateFee(fee: bigint): Promise<void> {
    const cycle = await this.getCurrentCycle();
    const poolShare = BigInt(Math.floor(Number(fee) * REWARD_POOL_SHARE));

    await this.pool.query(
      `UPDATE reward_cycles
       SET total_fees = total_fees + $2, pool_amount = pool_amount + $3
       WHERE id = $1`,
      [cycle.id, fee.toString(), poolShare.toString()],
    );
  }

  // ─── 周期分配 ──────────────────────────────────────────────────────────────

  /**
   * 分配已结束的周期奖励。
   * 按排行榜 weighted_score 占总分比例，分配 pool_amount。
   * 应由定时任务或手动触发调用。
   */
  async distributeExpiredCycles(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);

    const { rows: expiredCycles } = await this.pool.query<CycleRow>(
      `SELECT * FROM reward_cycles WHERE cycle_end <= $1 AND distributed = FALSE`,
      [now],
    );

    let distributed = 0;
    for (const cycleRow of expiredCycles) {
      await this.distributeCycle(cycleRow.id);
      distributed++;
    }
    return distributed;
  }

  private async distributeCycle(cycleId: number): Promise<void> {
    // 读取该周期的池金额
    const { rows: [cycle] } = await this.pool.query<CycleRow>(
      `SELECT * FROM reward_cycles WHERE id = $1`,
      [cycleId],
    );
    if (!cycle || cycle.distributed) return;

    const poolAmount = BigInt(cycle.pool_amount);
    if (poolAmount === 0n) {
      await this.pool.query(
        `UPDATE reward_cycles SET distributed = TRUE WHERE id = $1`,
        [cycleId],
      );
      return;
    }

    // 读取排行榜总分
    const { rows: scores } = await this.pool.query<{
      wallet: string;
      weighted_score: string;
    }>(
      `SELECT wallet, weighted_score::text FROM leaderboard_scores
       WHERE cycle_id = $1 AND weighted_score > 0
       ORDER BY weighted_score DESC`,
      [cycleId],
    );

    if (scores.length === 0) {
      await this.pool.query(
        `UPDATE reward_cycles SET distributed = TRUE WHERE id = $1`,
        [cycleId],
      );
      return;
    }

    const totalScore = scores.reduce((s, r) => s + parseFloat(r.weighted_score), 0);

    // 按比例分配
    let allocated = 0n;
    const allocations: { wallet: string; amount: bigint }[] = [];

    for (let i = 0; i < scores.length; i++) {
      const share = parseFloat(scores[i].weighted_score) / totalScore;
      const amount = i === scores.length - 1
        ? poolAmount - allocated  // 最后一人拿剩余（避免舍入损失）
        : BigInt(Math.floor(Number(poolAmount) * share));
      allocations.push({ wallet: scores[i].wallet, amount });
      allocated += amount;
    }

    // 写入 reward_amount
    for (const { wallet, amount } of allocations) {
      await this.pool.query(
        `UPDATE leaderboard_scores SET reward_amount = $3
         WHERE cycle_id = $1 AND wallet = $2`,
        [cycleId, wallet, amount.toString()],
      );
    }

    await this.pool.query(
      `UPDATE reward_cycles SET distributed = TRUE WHERE id = $1`,
      [cycleId],
    );
  }

  // ─── 领取奖励 ──────────────────────────────────────────────────────────────

  /**
   * 玩家领取指定周期的奖励。
   * 通过 relay wallet 从 treasury ATA 转账到玩家 ATA。
   */
  async claimReward(cycleId: number, wallet: string): Promise<RewardClaim> {
    // 1. 检查资格
    const { rows: [score] } = await this.pool.query<{
      reward_amount: string;
    }>(
      `SELECT reward_amount FROM leaderboard_scores
       WHERE cycle_id = $1 AND wallet = $2`,
      [cycleId, wallet],
    );

    if (!score) throw new Error('该周期无排行榜记录');

    const amount = BigInt(score.reward_amount);
    if (amount < MIN_CLAIM_AMOUNT) {
      throw new Error(`奖励金额 ${amount} 低于最低领取门槛 ${MIN_CLAIM_AMOUNT}`);
    }

    // 2. 检查是否已领取
    const { rows: existing } = await this.pool.query(
      `SELECT id FROM reward_claims WHERE cycle_id = $1 AND wallet = $2`,
      [cycleId, wallet],
    );
    if (existing.length > 0) throw new Error('该周期奖励已领取');

    // 3. 检查周期是否已分配
    const { rows: [cycle] } = await this.pool.query<CycleRow>(
      `SELECT * FROM reward_cycles WHERE id = $1`,
      [cycleId],
    );
    if (!cycle || !cycle.distributed) throw new Error('该周期尚未完成分配');

    // 4. 链上转账：treasury → 玩家 ATA
    const playerPubkey = new PublicKey(wallet);
    const playerAta = getAssociatedTokenAddressSync(
      this.mintAddress, playerPubkey, false, TOKEN_2022_PROGRAM_ID,
    );

    const ix = createTransferCheckedInstruction(
      this.treasuryAta,
      this.mintAddress,
      playerAta,
      this.relayerKeypair.publicKey,
      amount,
      this.mintDecimals,
      [],
      TOKEN_2022_PROGRAM_ID,
    );

    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = this.relayerKeypair.publicKey;
    tx.sign(this.relayerKeypair);

    const txSignature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature: txSignature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    // 5. 写入领取记录
    const claimedAt = Math.floor(Date.now() / 1000);
    await this.pool.query(
      `INSERT INTO reward_claims (cycle_id, wallet, amount, tx_signature, claimed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [cycleId, wallet, amount.toString(), txSignature, claimedAt],
    );

    return {
      cycleId,
      wallet,
      amount: amount.toString(),
      txSignature,
      claimedAt,
    };
  }

  // ─── 查询接口 ──────────────────────────────────────────────────────────────

  /** 获取玩家在指定周期的奖励信息 */
  async getPlayerReward(cycleId: number, wallet: string): Promise<{
    rewardAmount: string;
    claimed: boolean;
  } | null> {
    const { rows } = await this.pool.query<{
      reward_amount: string;
    }>(
      `SELECT reward_amount FROM leaderboard_scores
       WHERE cycle_id = $1 AND wallet = $2`,
      [cycleId, wallet],
    );
    if (rows.length === 0) return null;

    const { rows: claims } = await this.pool.query(
      `SELECT id FROM reward_claims WHERE cycle_id = $1 AND wallet = $2`,
      [cycleId, wallet],
    );

    return {
      rewardAmount: rows[0].reward_amount,
      claimed: claims.length > 0,
    };
  }

  /** 获取玩家的领取历史 */
  async getClaimHistory(wallet: string, limit: number = 10): Promise<RewardClaim[]> {
    const { rows } = await this.pool.query<ClaimRow>(
      `SELECT * FROM reward_claims WHERE wallet = $1 ORDER BY claimed_at DESC LIMIT $2`,
      [wallet, limit],
    );
    return rows.map(r => ({
      cycleId:     r.cycle_id,
      wallet:      r.wallet,
      amount:      r.amount.toString(),
      txSignature: r.tx_signature,
      claimedAt:   Number(r.claimed_at),
    }));
  }

  // ─── 内部类型转换 ──────────────────────────────────────────────────────────

  private toCycle(row: CycleRow): RewardCycle {
    return {
      id:          row.id,
      cycleStart:  Number(row.cycle_start),
      cycleEnd:    Number(row.cycle_end),
      totalFees:   row.total_fees.toString(),
      poolAmount:  row.pool_amount.toString(),
      distributed: row.distributed,
    };
  }
}

// ─── 数据库行类型 ──────────────────────────────────────────────────────────

interface CycleRow {
  id:          number;
  cycle_start: string;
  cycle_end:   string;
  total_fees:  string;
  pool_amount: string;
  distributed: boolean;
}

interface ClaimRow {
  cycle_id:     number;
  wallet:       string;
  amount:       string;
  tx_signature: string;
  claimed_at:   string;
}
