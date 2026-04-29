/**
 * economy.ts — 代币经济模型参数（单一来源）
 *
 * 全项目所有模块必须从这里 import，禁止在其他文件硬编码数值。
 */

// ─── 手续费 ──────────────────────────────────────────────────────────────────

/** 手续费比例 BPS（基点），200 = 2%。链上合约已固定此值，不可更改。 */
export const FEE_BPS = 200;

// ─── 奖励池周期 ──────────────────────────────────────────────────────────────

/** 奖励周期长度（天） */
export const REWARD_CYCLE_DAYS = 7;

/** 奖励周期长度（秒） */
export const REWARD_CYCLE_SECS = REWARD_CYCLE_DAYS * 86_400;

/** 手续费进入奖励池的比例（80%），剩余 20% 留给 treasury */
export const REWARD_POOL_SHARE = 0.8;

/** 领取奖励的最低门槛（lamport） — 低于此金额不允许领取，减少链上垃圾交易 */
export const MIN_CLAIM_AMOUNT = 1_000n;

// ─── 排行榜评分权重 ──────────────────────────────────────────────────────────

/** 对局数权重（40%） */
export const WEIGHT_GAMES = 0.4;

/** 胜率权重（30%） */
export const WEIGHT_WINS = 0.3;

/** 精彩操作权重（30%） — 炸弹、火箭、春天等 */
export const WEIGHT_HIGHLIGHTS = 0.3;

// ─── 反作弊：对局质量 ────────────────────────────────────────────────────────

/**
 * 对局时长 → 质量权重映射。
 * 过短的对局视为可能的刷分行为，降低奖励权重。
 */
export const DURATION_QUALITY: { maxSecs: number; weight: number }[] = [
  { maxSecs: 30,  weight: 0.0 },   // < 30s 视为无效
  { maxSecs: 60,  weight: 0.2 },   // 30-60s 极低权重
  { maxSecs: 120, weight: 0.5 },   // 1-2min 半权重
  { maxSecs: 300, weight: 0.8 },   // 2-5min 轻微折扣
  { maxSecs: Infinity, weight: 1.0 }, // ≥5min 完整权重
];

/** 新账户冷启动期：前 N 局逐步提升权重，防止 sybil 新号刷分 */
export const WARMUP_GAMES = 10;

/** 冷启动期内的权重公式：weight = min(gamesPlayed / WARMUP_GAMES, 1.0) */
export function warmupFactor(gamesPlayed: number): number {
  return Math.min(gamesPlayed / WARMUP_GAMES, 1.0);
}

// ─── 反作弊：共谋检测 ────────────────────────────────────────────────────────

/**
 * 共现阈值：两个钱包在 COLLUSION_WINDOW 天内同房间出现 ≥ COLLUSION_THRESHOLD 次，
 * 触发共谋标记，对应对局的奖励权重归零。
 */
export const COLLUSION_WINDOW_DAYS = 7;
export const COLLUSION_THRESHOLD = 5;

// ─── 精彩操作定义 ────────────────────────────────────────────────────────────

/** 精彩操作（highlight）计数内容 */
export const HIGHLIGHT_ACTIONS = ['bomb', 'rocket', 'spring', 'antiSpring'] as const;
export type HighlightAction = typeof HIGHLIGHT_ACTIONS[number];
