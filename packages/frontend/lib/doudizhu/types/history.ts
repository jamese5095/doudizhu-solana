/**
 * history.ts — 历史对局记录类型
 *
 * 由服务器在结算完成后写入 PostgreSQL，前端通过 GET /api/history 查询。
 * delta 字段以字符串形式传输，避免 bigint JSON 序列化问题，前端用 BigInt(v) 解析。
 */

export interface GameRecord {
  roomId:          string;
  txSignature:     string;
  winnerId:        string;
  /** BetTier 枚举映射到整数：Small=0 Medium=1 Large=2 Whale=3 */
  betTier:         number;
  finalMultiplier: number;
  /** Unix 时间戳（秒） */
  settledAt:       number;
  payouts:         { playerId: string; delta: string }[];
  /** 相对于查询钱包：true = 盈利 */
  isWin:           boolean;
  /** 相对于查询钱包的 delta（字符串形式的 bigint） */
  myDelta:         string;
}
