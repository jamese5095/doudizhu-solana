/**
 * LeaderboardService — 排行榜管理
 *
 * 职责：
 * 1. 每局结算后更新玩家在当前周期的统计数据
 * 2. 计算加权分数（40% 对局数 + 30% 胜率 + 30% 精彩操作）
 * 3. 查询排行榜（支持分页）
 */

import type { Pool } from 'pg';
import type { LeaderboardEntry } from '@doudizhu/types';
import {
  WEIGHT_GAMES,
  WEIGHT_WINS,
  WEIGHT_HIGHLIGHTS,
} from '../lib/economy';

export class LeaderboardService {
  constructor(private readonly pool: Pool) {}

  /**
   * 结算后更新排行榜数据。
   * 为本局所有玩家 UPSERT 统计，并重新计算加权分数。
   *
   * @param cycleId     当前奖励周期 ID
   * @param wallets     本局三个玩家钱包
   * @param winnerId    胜者钱包
   * @param highlightCount 本局精彩操作数（炸弹+火箭+春天+反春天）
   * @param qualityWeight  本局质量权重 ∈ [0, 1]
   */
  async updateAfterGame(
    cycleId: number,
    wallets: string[],
    winnerId: string,
    highlightCount: number,
    qualityWeight: number,
  ): Promise<void> {
    for (const wallet of wallets) {
      const isWinner = wallet === winnerId;
      // 按质量权重折算：低质量对局贡献减少
      const weightedGames      = qualityWeight;
      const weightedWins       = isWinner ? qualityWeight : 0;
      const weightedHighlights = highlightCount * qualityWeight;

      // UPSERT: 累加统计数据
      await this.pool.query(
        `INSERT INTO leaderboard_scores (cycle_id, wallet, games_played, games_won, highlights)
         VALUES ($1, $2, 1, $3, $4)
         ON CONFLICT (cycle_id, wallet) DO UPDATE SET
           games_played = leaderboard_scores.games_played + 1,
           games_won    = leaderboard_scores.games_won + $3,
           highlights   = leaderboard_scores.highlights + $4`,
        [cycleId, wallet, isWinner ? 1 : 0, highlightCount],
      );

      // 重新计算加权分数
      // 使用质量权重折算后的增量更新 weighted_score
      await this.pool.query(
        `UPDATE leaderboard_scores SET weighted_score = (
           $2 * games_played +
           $3 * CASE WHEN games_played > 0 THEN games_won::real / games_played ELSE 0 END +
           $4 * highlights
         )
         WHERE cycle_id = $1 AND wallet = $5`,
        [cycleId, WEIGHT_GAMES, WEIGHT_WINS, WEIGHT_HIGHLIGHTS, wallet],
      );
    }
  }

  /**
   * 查询排行榜（支持分页）。
   * 按 weighted_score 降序排列。
   */
  async getLeaderboard(
    cycleId: number,
    limit: number = 50,
    offset: number = 0,
  ): Promise<LeaderboardEntry[]> {
    const { rows } = await this.pool.query<LeaderboardRow>(
      `SELECT wallet, games_played, games_won, highlights,
              weighted_score, reward_amount
       FROM leaderboard_scores
       WHERE cycle_id = $1
       ORDER BY weighted_score DESC
       LIMIT $2 OFFSET $3`,
      [cycleId, limit, offset],
    );

    return rows.map((row, i) => ({
      rank:          offset + i + 1,
      wallet:        row.wallet,
      gamesPlayed:   row.games_played,
      gamesWon:      row.games_won,
      highlights:    row.highlights,
      weightedScore: parseFloat(row.weighted_score),
      rewardAmount:  row.reward_amount.toString(),
    }));
  }

  /** 查询玩家在指定周期的排行信息 */
  async getPlayerScore(cycleId: number, wallet: string): Promise<LeaderboardEntry | null> {
    // 先查该玩家的分数
    const { rows } = await this.pool.query<LeaderboardRow>(
      `SELECT wallet, games_played, games_won, highlights,
              weighted_score, reward_amount
       FROM leaderboard_scores
       WHERE cycle_id = $1 AND wallet = $2`,
      [cycleId, wallet],
    );
    if (rows.length === 0) return null;

    // 查排名
    const { rows: [{ rank }] } = await this.pool.query<{ rank: string }>(
      `SELECT COUNT(*)::text AS rank FROM leaderboard_scores
       WHERE cycle_id = $1 AND weighted_score > $2`,
      [cycleId, rows[0].weighted_score],
    );

    const row = rows[0];
    return {
      rank:          parseInt(rank, 10) + 1,
      wallet:        row.wallet,
      gamesPlayed:   row.games_played,
      gamesWon:      row.games_won,
      highlights:    row.highlights,
      weightedScore: parseFloat(row.weighted_score),
      rewardAmount:  row.reward_amount.toString(),
    };
  }
}

// ─── 数据库行类型 ──────────────────────────────────────────────────────────

interface LeaderboardRow {
  wallet:         string;
  games_played:   number;
  games_won:      number;
  highlights:     number;
  weighted_score: string;
  reward_amount:  string;
}
