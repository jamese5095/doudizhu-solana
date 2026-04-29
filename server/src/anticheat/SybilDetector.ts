/**
 * SybilDetector — 反作弊模块
 *
 * 基于对局质量评分、冷启动期权重、IP 冲突检测和共谋检测，
 * 为每局对局计算一个 qualityWeight ∈ [0, 1]，用于奖励池分配折扣。
 */

import type { Pool } from 'pg';
import {
  DURATION_QUALITY,
  warmupFactor,
  COLLUSION_WINDOW_DAYS,
  COLLUSION_THRESHOLD,
} from '../lib/economy';

export interface QualityResult {
  /** 综合质量权重 ∈ [0, 1] */
  qualityWeight: number;
  /** 时长权重 */
  durationWeight: number;
  /** 冷启动权重 */
  warmupWeight: number;
  /** 是否检测到 IP 冲突 */
  ipConflict: boolean;
}

export class SybilDetector {
  constructor(private readonly pool: Pool) {}

  /**
   * 计算一局对局的质量权重。
   *
   * @param durationSecs 对局时长（秒）
   * @param playerWallets 本局三个玩家钱包地址
   * @param playerIps 本局三个玩家 IP 地址（可能为 null，如单机模式）
   */
  async evaluate(
    durationSecs: number,
    playerWallets: string[],
    playerIps: (string | null)[],
  ): Promise<QualityResult> {
    const durationWeight = this.getDurationWeight(durationSecs);
    const ipConflict     = this.checkIpConflict(playerIps);

    // 取三个玩家中最低的冷启动权重
    const warmupWeights = await Promise.all(
      playerWallets.map(w => this.getWarmupWeight(w)),
    );
    const warmupWeight = Math.min(...warmupWeights);

    // 共谋检测：任意两人共现过多则归零
    const collusionDetected = await this.checkCollusion(playerWallets);

    // 综合权重 = 各维度取最小值（任一维度异常即限制整局奖励）
    let qualityWeight = Math.min(durationWeight, warmupWeight);
    if (ipConflict) qualityWeight *= 0.1;     // IP 冲突严重折扣
    if (collusionDetected) qualityWeight = 0;  // 共谋直接归零

    return { qualityWeight, durationWeight, warmupWeight, ipConflict };
  }

  /** 对局时长 → 质量权重 */
  getDurationWeight(durationSecs: number): number {
    for (const tier of DURATION_QUALITY) {
      if (durationSecs < tier.maxSecs) return tier.weight;
    }
    return 1.0;
  }

  /** 查询该钱包历史对局数，计算冷启动权重 */
  private async getWarmupWeight(wallet: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM game_records
       WHERE payouts @> $1::jsonb`,
      [JSON.stringify([{ playerId: wallet }])],
    );
    const gamesPlayed = parseInt(rows[0].count, 10);
    return warmupFactor(gamesPlayed);
  }

  /** 同房间内是否存在两个或以上相同 IP */
  checkIpConflict(ips: (string | null)[]): boolean {
    const valid = ips.filter((ip): ip is string => ip !== null);
    const unique = new Set(valid);
    return unique.size < valid.length;
  }

  /**
   * 共谋检测：查看任意两个钱包在最近 N 天内是否同房间共现 ≥ 阈值次。
   * 三人游戏需要检查 C(3,2) = 3 种组合。
   */
  private async checkCollusion(wallets: string[]): Promise<boolean> {
    if (wallets.length < 2) return false;

    const windowStart = Math.floor(Date.now() / 1000) - COLLUSION_WINDOW_DAYS * 86_400;

    // 检查每对玩家
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const { rows } = await this.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM game_records
           WHERE settled_at >= $1
             AND payouts @> $2::jsonb
             AND payouts @> $3::jsonb`,
          [
            windowStart,
            JSON.stringify([{ playerId: wallets[i] }]),
            JSON.stringify([{ playerId: wallets[j] }]),
          ],
        );
        if (parseInt(rows[0].count, 10) >= COLLUSION_THRESHOLD) return true;
      }
    }
    return false;
  }
}
