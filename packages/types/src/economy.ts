/**
 * economy.ts — 代币经济模型类型
 *
 * 排行榜、奖励池周期、奖励领取相关接口。
 * 金额字段使用 string 传输（bigint JSON 序列化），前端用 BigInt(v) 解析。
 */

/** 奖励池周期 */
export interface RewardCycle {
  id:           number;
  cycleStart:   number;   // Unix 时间戳（秒）
  cycleEnd:     number;
  totalFees:    string;   // bigint as string (lamport)
  poolAmount:   string;   // bigint as string
  distributed:  boolean;
}

/** 排行榜条目 */
export interface LeaderboardEntry {
  rank:          number;
  wallet:        string;
  gamesPlayed:   number;
  gamesWon:      number;
  highlights:    number;
  weightedScore: number;
  rewardAmount:  string;  // bigint as string (lamport)
}

/** 奖励领取记录 */
export interface RewardClaim {
  cycleId:      number;
  wallet:       string;
  amount:       string;   // bigint as string
  txSignature:  string;
  claimedAt:    number;
}

/** 奖励池状态摘要（前端展示用） */
export interface RewardPoolStatus {
  currentCycle:    RewardCycle;
  daysRemaining:   number;
  myScore:         LeaderboardEntry | null;
  topPlayers:      LeaderboardEntry[];
}
