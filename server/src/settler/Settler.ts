/**
 * Settler — 结算中继器
 *
 * 监听 GameStateMachine 的 gameOver 事件，调用链上 settle 指令，
 * 完成资金分配并验证链上结算结果。
 *
 * roomId 约定：32 位小写十六进制字符串（UUID 去连字符），对应链上 [u8;16]。
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { BetTier } from '@doudizhu/types';
import type { RoomManager } from '../room/RoomManager';
import type { GameOverPayload } from '../game/GameStateMachine';

// ─── Public types ────────────────────────────────────────────────────────────

export interface SettleResult {
  roomId:          string;
  txSignature:     string;
  winnerId:        string;
  finalMultiplier: number;
  /** BetTier 枚举映射到整数：Small=0 Medium=1 Large=2 Whale=3 */
  betTier:         number;
  payouts:         { playerId: string; delta: bigint }[];
  fee:             bigint;
  verified:        boolean;
  settledAt:       number; // unix timestamp
}

export class AlreadySettledError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AlreadySettledError';
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SettleAccounts {
  room: PublicKey;
  escrow: PublicKey;
  escrowTokenAccount: PublicKey;
  player0TokenAccount: PublicKey;
  player1TokenAccount: PublicKey;
  player2TokenAccount: PublicKey;
  treasuryTokenAccount: PublicKey;
  mint: PublicKey;
  relay: PublicKey;
  tokenProgram: PublicKey;
  associatedTokenProgram: PublicKey;
  systemProgram: PublicKey;
}

// Minimal anchor Program interface for testability
interface AnchorProgram {
  programId: PublicKey;
  account: {
    escrowAccount: { fetch(pk: PublicKey): Promise<EscrowOnChain> };
    roomAccount:   { fetch(pk: PublicKey): Promise<RoomOnChain> };
  };
  methods: {
    settle(
      roomId: number[],
      winnerIndex: number,
      landlordIndex: number,
      finalMultiplier: number,
    ): {
      accounts(accts: SettleAccounts): {
        transaction(): Promise<Transaction>;
      };
    };
  };
  provider: {
    connection: SolanaConnection;
  };
}

interface EscrowOnChain {
  isSettled: boolean;
  deposits: Array<{ toString(): string }>;
}

interface RoomOnChain {
  baseScore: { toString(): string };
  landlordIndex: number;
  players: PublicKey[];
}

interface SolanaConnection {
  getLatestBlockhash(commitment?: string): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(raw: Buffer | Uint8Array, opts?: { skipPreflight?: boolean }): Promise<string>;
  confirmTransaction(
    info: { signature: string; blockhash: string; lastValidBlockHeight: number },
    commitment?: string,
  ): Promise<unknown>;
  getTokenAccountBalance(pk: PublicKey): Promise<{ value: { amount: string } }>;
}

// ─── Settler ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Settler {
  private readonly programId: PublicKey;
  private readonly connection: SolanaConnection;

  constructor(
    private readonly rm: RoomManager,
    private readonly program: AnchorProgram,
    private readonly relayerKeypair: Keypair,
    private readonly mintAddress: PublicKey,
    private readonly treasuryAta: PublicKey,
  ) {
    this.programId  = program.programId;
    this.connection = program.provider.connection;
  }

  // ─── Public: main entry point ─────────────────────────────────────────────

  async settle(event: GameOverPayload): Promise<SettleResult> {
    // 1. 参数校验
    if (event.finalMultiplier < 1) {
      throw new Error(`finalMultiplier must be >= 1, got ${event.finalMultiplier}`);
    }

    const state = await this.rm.getRoom(event.roomId);
    if (state === null) throw new Error(`Room "${event.roomId}" not found in Redis`);

    const playerIds = state.players.map(p => p.playerId);
    const winnerIndex = playerIds.indexOf(event.winnerId);
    if (winnerIndex === -1) {
      throw new Error(`winnerId "${event.winnerId}" is not a member of room "${event.roomId}"`);
    }

    const landlordIndex = state.landlordIndex;
    const roomIdBytes = this.roomIdToBytes(event.roomId);

    // 验证链上 is_settled（双重防重入）
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(roomIdBytes)],
      this.programId,
    );
    const escrowOnChain = await this.program.account.escrowAccount.fetch(escrowPda);
    if (escrowOnChain.isSettled) {
      throw new AlreadySettledError(`Room "${event.roomId}" is already settled on-chain`);
    }

    // 2. 构建账户
    const playerPubkeys = playerIds.map(id => new PublicKey(id));
    const playerAtas = playerPubkeys.map(pk =>
      getAssociatedTokenAddressSync(this.mintAddress, pk, false, TOKEN_2022_PROGRAM_ID),
    );
    const accounts = this.buildAccounts(roomIdBytes, playerPubkeys, playerAtas);

    // 读取链上 RoomAccount（获取 base_score，在发送交易前读取）
    const [roomPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('room'), Buffer.from(roomIdBytes)],
      this.programId,
    );
    const roomOnChain = await this.program.account.roomAccount.fetch(roomPda);
    const baseScore = BigInt(roomOnChain.baseScore.toString());

    // 快照结算前余额（join_and_deposit 之后，settle 之前）
    // 注意：此时玩家存款已转入 escrow，settle 后 escrow 将退还 deposit+盈亏
    // verifySettlement 使用此快照对比，预期 delta 需加回 deposit 金额
    const preBalances = await Promise.all(
      [...playerAtas, this.treasuryAta].map(ata =>
        this.connection
          .getTokenAccountBalance(ata)
          .then(r => BigInt(r.value.amount))
          .catch(() => 0n),
      ),
    );

    // 3. 构建并发送交易（带重试）
    const txSignature = await this.sendWithRetry(
      roomIdBytes,
      winnerIndex,
      landlordIndex,
      event.finalMultiplier,
      accounts,
    );

    // 4. 等待 finalized 确认（超时不重试，防止双重结算）
    const latestBlockhash = await this.connection.getLatestBlockhash('finalized');
    try {
      await this.connection.confirmTransaction(
        { signature: txSignature, ...latestBlockhash },
        'finalized',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Settler] confirmTransaction timeout for "${event.roomId}": ${msg}`);
      // 不重试，继续验证
    }

    // 计算 payouts 和 fee
    const payouts = this.computePayouts(winnerIndex, landlordIndex, baseScore, event.finalMultiplier, playerIds);
    const fee     = this.computeFee(winnerIndex, landlordIndex, baseScore, event.finalMultiplier);

    // 5. 验证结算（非阻塞，结果写入 verified 字段）
    // payouts 中的 delta 是相对于存款前余额的净变化；
    // verifySettlement 的 preBalances 是存款后余额，故传入 baseScore 以还原对比基准
    const expectedDeltas = new Map<string, bigint>(payouts.map(p => [p.playerId, p.delta]));
    const verified = await this.verifySettlement(
      expectedDeltas,
      playerIds,
      playerAtas,
      preBalances,
      baseScore,
    );

    return {
      roomId:          event.roomId,
      txSignature,
      winnerId:        event.winnerId,
      finalMultiplier: event.finalMultiplier,
      betTier:         this.betTierToNumber(state.betTier),
      payouts,
      fee,
      verified,
      settledAt:       Math.floor(Date.now() / 1000),
    };
  }

  // ─── Private: account builder ─────────────────────────────────────────────

  private buildAccounts(
    roomIdBytes: number[],
    playerPubkeys: PublicKey[],
    playerAtas: PublicKey[],
  ): SettleAccounts {
    const [roomPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('room'), Buffer.from(roomIdBytes)],
      this.programId,
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(roomIdBytes)],
      this.programId,
    );
    const escrowAta = getAssociatedTokenAddressSync(
      this.mintAddress,
      escrowPda,
      true, // PDA can own an ATA
      TOKEN_2022_PROGRAM_ID,
    );
    void playerPubkeys; // already used to derive playerAtas

    return {
      room:                roomPda,
      escrow:              escrowPda,
      escrowTokenAccount:  escrowAta,
      player0TokenAccount: playerAtas[0],
      player1TokenAccount: playerAtas[1],
      player2TokenAccount: playerAtas[2],
      treasuryTokenAccount: this.treasuryAta,
      mint:                this.mintAddress,
      relay:               this.relayerKeypair.publicKey,
      tokenProgram:        TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
      systemProgram:       SystemProgram.programId,
    };
  }

  // ─── Private: send with retry ─────────────────────────────────────────────

  private async sendWithRetry(
    roomIdBytes: number[],
    winnerIndex: number,
    landlordIndex: number,
    finalMultiplier: number,
    accounts: SettleAccounts,
  ): Promise<string> {
    const DELAYS_MS = [1_000, 2_000, 4_000];
    let lastError: Error = new Error('Unknown send error');

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(DELAYS_MS[attempt - 1]);

      try {
        // 每次重试都获取新的 blockhash，防止过期
        const tx: Transaction = await this.program.methods
          .settle(roomIdBytes, winnerIndex, landlordIndex, finalMultiplier)
          .accounts(accounts)
          .transaction();

        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash();

        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = this.relayerKeypair.publicKey;
        tx.sign(this.relayerKeypair);

        const sig = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
        });
        return sig;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        // AlreadySettled：已结算成功（之前某次交易上链了），立即停止
        if (msg.includes('AlreadySettled')) {
          throw new AlreadySettledError(
            `Room settled by a previous attempt (attempt ${attempt + 1}): ${msg}`,
          );
        }

        lastError = err instanceof Error ? err : new Error(msg);
        console.warn(`[Settler] sendWithRetry attempt ${attempt + 1}/3 failed: ${msg}`);
        // 网络超时等情况：下次循环会重新获取 blockhash，无需额外处理
      }
    }

    throw lastError;
  }

  // ─── Private: verify settlement ───────────────────────────────────────────

  /**
   * 读取结算后余额，与预期 delta 对比（误差容忍 ±1 lamport，来自整数除法）。
   */
  private async verifySettlement(
    expectedDeltas: Map<string, bigint>,
    playerIds: string[],
    playerAtas: PublicKey[],
    preBalances: bigint[], // index 0-2 = players (post-deposit), index 3 = treasury
    baseScore: bigint,    // each player's deposit amount; added back to expectedDelta for post-deposit comparison
  ): Promise<boolean> {
    try {
      const postPlayerBalances = await Promise.all(
        [...playerAtas, this.treasuryAta].map(ata =>
          this.connection
            .getTokenAccountBalance(ata)
            .then(r => BigInt(r.value.amount))
            .catch(() => 0n),
        ),
      );

      let allOk = true;
      for (let i = 0; i < 3; i++) {
        const actualDelta = postPlayerBalances[i] - preBalances[i];
        // expectedDelta is relative to pre-deposit; preBalances was taken post-deposit.
        // On-chain settle returns deposit + net winnings from escrow, so add baseScore.
        const expectedDelta = (expectedDeltas.get(playerIds[i]) ?? 0n) + baseScore;
        const diff = actualDelta >= expectedDelta
          ? actualDelta - expectedDelta
          : expectedDelta - actualDelta;

        if (diff > 1n) {
          console.warn(
            `[Settler] verifySettlement mismatch for ${playerIds[i]}: ` +
            `actualDelta=${actualDelta}, expectedDelta=${expectedDelta}, diff=${diff}`,
          );
          allOk = false;
        }
      }
      return allOk;
    } catch (err: unknown) {
      console.warn('[Settler] verifySettlement error:', err);
      return false;
    }
  }

  // ─── Private: payout math ────────────────────────────────────────────────

  /**
   * 计算各玩家净变化量（相对于存款前余额）。
   * 地主胜：各农民扣 min(unit, deposit)，地主得扣款×98%。
   * 农民胜：地主扣 min(unit×2, deposit)，两农民均分×98%（余数给首位农民）。
   */
  private computePayouts(
    winnerIndex: number,
    landlordIndex: number,
    baseScore: bigint,
    finalMultiplier: number,
    playerIds: string[],
  ): { playerId: string; delta: bigint }[] {
    const unit = baseScore * BigInt(finalMultiplier);
    const deltas = [0n, 0n, 0n];

    if (winnerIndex === landlordIndex) {
      // 地主胜
      let totalDeducted = 0n;
      for (let i = 0; i < 3; i++) {
        if (i !== landlordIndex) {
          const deduction = unit < baseScore ? unit : baseScore;
          deltas[i] = -deduction;
          totalDeducted += deduction;
        }
      }
      const fee = (totalDeducted * 2n) / 100n;
      deltas[landlordIndex] = totalDeducted - fee;
    } else {
      // 农民胜
      const landlordDeduction = unit * 2n < baseScore ? unit * 2n : baseScore;
      const fee = (landlordDeduction * 2n) / 100n;
      const farmerBonus = landlordDeduction - fee;
      deltas[landlordIndex] = -landlordDeduction;

      const farmers = [0, 1, 2].filter(i => i !== landlordIndex);
      const half = farmerBonus / 2n;
      const rem  = farmerBonus % 2n;
      deltas[farmers[0]] = half + rem; // 余数归第一位农民
      deltas[farmers[1]] = half;
    }

    return playerIds.map((playerId, i) => ({ playerId, delta: deltas[i] }));
  }

  private computeFee(
    winnerIndex: number,
    landlordIndex: number,
    baseScore: bigint,
    finalMultiplier: number,
  ): bigint {
    const unit = baseScore * BigInt(finalMultiplier);
    if (winnerIndex === landlordIndex) {
      const deductionPerFarmer = unit < baseScore ? unit : baseScore;
      return (deductionPerFarmer * 2n * 2n) / 100n; // 2 farmers
    } else {
      const landlordDeduction = unit * 2n < baseScore ? unit * 2n : baseScore;
      return (landlordDeduction * 2n) / 100n;
    }
  }

  // ─── Private: helpers ────────────────────────────────────────────────────

  private betTierToNumber(tier: BetTier): number {
    const map: Record<BetTier, number> = {
      [BetTier.Small]:  0,
      [BetTier.Medium]: 1,
      [BetTier.Large]:  2,
      [BetTier.Whale]:  3,
    };
    return map[tier] ?? 0;
  }

  /**
   * roomId 字符串 → 16 字节数组。
   * 支持 32 位十六进制（UUID 去连字符）和 UTF-8 填充（遗留格式）。
   */
  private roomIdToBytes(roomId: string): number[] {
    const clean = roomId.replace(/-/g, '');
    if (/^[0-9a-fA-F]{32}$/.test(clean)) {
      return Array.from(Buffer.from(clean, 'hex'));
    }
    // Fallback: UTF-8 填充至 16 字节（兼容 "gw-test-room-001" 等旧格式）
    const buf = Buffer.alloc(16, 0);
    Buffer.from(roomId, 'utf8').copy(buf, 0, 0, 16);
    return Array.from(buf);
  }
}
