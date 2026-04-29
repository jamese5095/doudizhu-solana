import type { Pool } from 'pg';
import type { SettleResult } from '../settler/Settler';
import type { GameRecord } from '@doudizhu/types';

interface GameRecordRow {
  room_id:          string;
  tx_signature:     string;
  winner_id:        string;
  bet_tier:         number;
  final_multiplier: number;
  settled_at:       string; // pg returns BIGINT as string
  payouts:          { playerId: string; delta: string }[];
}

export class HistoryRepository {
  constructor(private readonly pool: Pool) {}

  /** 结算完成后写入记录。写入失败只记录日志，不抛出。 */
  async saveRecord(result: SettleResult): Promise<void> {
    const payouts = result.payouts.map(p => ({
      playerId: p.playerId,
      delta:    p.delta.toString(),
    }));

    await this.pool.query(
      `INSERT INTO game_records
         (room_id, tx_signature, winner_id, bet_tier, final_multiplier, settled_at, payouts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tx_signature) DO NOTHING`,
      [
        result.roomId,
        result.txSignature,
        result.winnerId,
        result.betTier,
        result.finalMultiplier,
        result.settledAt,
        JSON.stringify(payouts),
      ],
    );
  }

  /** 结算后追加经济模型字段（质量权重、精彩操作等） */
  async updateGameQuality(
    roomId: string,
    data: {
      durationSecs: number;
      qualityWeight: number;
      highlightCount: number;
      ipConflict: boolean;
    },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE game_records
       SET duration_secs = $2, quality_weight = $3, highlight_count = $4, ip_conflict = $5
       WHERE room_id = $1`,
      [roomId, data.durationSecs, data.qualityWeight, data.highlightCount, data.ipConflict],
    );
  }

  /** 返回该钱包参与的最近 N 条记录，未参与时返回空数组。 */
  async getByWallet(walletAddress: string, limit: number = 5): Promise<GameRecord[]> {
    const { rows } = await this.pool.query<GameRecordRow>(
      `SELECT * FROM game_records
       WHERE payouts @> $1::jsonb
       ORDER BY settled_at DESC
       LIMIT $2`,
      [JSON.stringify([{ playerId: walletAddress }]), limit],
    );

    return rows.map(row => {
      const myPayout = row.payouts.find(p => p.playerId === walletAddress);
      const myDelta  = myPayout?.delta ?? '0';
      const isWin    = BigInt(myDelta) > 0n;

      return {
        roomId:          row.room_id,
        txSignature:     row.tx_signature,
        winnerId:        row.winner_id,
        betTier:         row.bet_tier,
        finalMultiplier: row.final_multiplier,
        settledAt:       Number(row.settled_at),
        payouts:         row.payouts,
        isWin,
        myDelta,
      };
    });
  }
}
