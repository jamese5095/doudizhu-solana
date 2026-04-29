/**
 * betting.ts — 质押、房间等级与结算相关类型
 *
 * 设计模型：
 *   玩家质押 DDZ 到协议 → 系统按质押量级分配房间等级（TierConfig.minStake）
 *   → 进入对应底分（baseScore）的房间 → 每局盈亏 = baseScore × 最终倍率
 *
 * 所有金额使用 bigint（代币最小精度单位），严禁使用 JS number 表示金额。
 * 具体档位数值（minStake / baseScore）可在后续开发中调整，类型契约不变。
 */

/**
 * 房间等级枚举，按质押量级从低到高划分。
 * 等级越高，底分越高，倍率触发后的盈亏幅度越大。
 */
export enum BetTier {
  Small  = 'SMALL',  // 小注场：新手 / 低质押量
  Medium = 'MEDIUM', // 中注场：标准场次
  Large  = 'LARGE',  // 大注场：高质押量
  Whale  = 'WHALE',  // 鲸鱼场：顶级场次
}

/**
 * 房间等级配置，由系统维护，玩家无法手动选择。
 * 系统根据玩家质押量（stakeAmount）匹配 minStake 最近的等级。
 */
export interface TierConfig {
  readonly tier:        BetTier;
  /** 进入该等级房间所需的最低质押量（含）*/
  readonly minStake:    bigint;
  /**
   * 该等级每局底分，即倍率为 1 时的基础盈亏单位。
   * 实际盈亏 = baseScore × finalMultiplier
   */
  readonly baseScore:   bigint;
}

/**
 * 结算结果，链上 CPI 完成后由服务器生成并广播。
 * payouts 中 delta 为正表示获得代币，为负表示失去代币。
 */
export interface SettlementResult {
  /** 胜者玩家 ID */
  readonly winnerId:        string;
  /** 败者玩家 ID 列表 */
  readonly losers:          readonly string[];
  /** 本局底分（来自房间 TierConfig.baseScore）*/
  readonly baseAmount:      bigint;
  /** 最终倍率（所有倍率事件连乘结果） */
  readonly finalMultiplier: number;
  /** 各玩家实际收支明细 */
  readonly payouts:         readonly { readonly playerId: string; readonly delta: bigint }[];
  /** 本局使用的代币 Mint 地址 */
  readonly mintAddress:     string;
}

/**
 * 倍率事件枚举，每种事件触发时将当前倍率乘以对应因子。
 * 具体倍率数值在 M2 阶段确定，当前为占位默认值。
 */
export enum MultiplierEvent {
  BidLandlord = 'bid_landlord', // 叫地主
  ShowCards   = 'show_cards',   // 明牌
  Double      = 'double',       // 加倍
  Bomb        = 'bomb',         // 炸弹
  Spring      = 'spring',       // 春天
  AntiSpring  = 'anti_spring',  // 反春天
}

/**
 * 各倍率事件对应的乘法因子（占位值，M2 阶段根据规则确认后更新）。
 * 结算公式：finalMultiplier = ∏ MULTIPLIER_FACTORS[event] for each triggered event
 */
export const MULTIPLIER_FACTORS: Record<MultiplierEvent, number> = {
  [MultiplierEvent.BidLandlord]: 1,
  [MultiplierEvent.ShowCards]:   2,
  [MultiplierEvent.Double]:      2,
  [MultiplierEvent.Bomb]:        2,
  [MultiplierEvent.Spring]:      2,
  [MultiplierEvent.AntiSpring]:  2,
};
