/**
 * pattern.ts — 牌型相关类型
 * 覆盖斗地主全部合法出牌组合，供游戏引擎解析与校验使用。
 */

import type { Card } from './card';

/**
 * 牌型枚举，列举斗地主所有合法出牌类型。
 * - 顺子：最少 5 张连续（3-A，不含 2 和王）
 * - 连对：最少 3 对连续
 * - 飞机：最少 2 组连续三张（不带翅膀）
 * - 飞机带翅膀：飞机 + 与飞机组数相同数量的附牌（单张或对子，视规则而定）
 * - 四带二：四张相同 + 2 张附牌（附牌可为 2 单或 1 对，视规则而定）
 */
export enum CardPattern {
  Single             = 'Single',             // 单张
  Pair               = 'Pair',               // 对子（两张相同）
  Triple             = 'Triple',             // 三张（不带）
  TripleWithOne      = 'TripleWithOne',      // 三带一（三张 + 1 单）
  TripleWithPair     = 'TripleWithPair',     // 三带二（三张 + 1 对）
  Straight           = 'Straight',           // 顺子（5 张起，最多 12 张）
  ConsecutivePairs   = 'ConsecutivePairs',   // 连对（3 对起）
  Airplane           = 'Airplane',           // 飞机（2 组连续三张，不带翅膀）
  AirplaneWithWings  = 'AirplaneWithWings',  // 飞机带翅膀
  FourWithTwo        = 'FourWithTwo',        // 四带二（炸带附牌）
  Bomb               = 'Bomb',               // 炸弹（四张相同）
  Rocket             = 'Rocket',             // 火箭（小王 + 大王，最大牌型）
}

/**
 * 已解析的出牌。
 * rank 为同牌型内的比较基准值（rank 越大越强），具体含义由游戏引擎定义：
 * 单张/对子/三张取主牌面值；顺子/连对/飞机取最小牌面值。
 */
export interface ParsedPlay {
  readonly pattern: CardPattern;
  readonly cards:   readonly Card[];
  readonly rank:    number;
}

/**
 * 出牌合法性校验结果（discriminated union）。
 * valid=true 时出牌合法；valid=false 时附带不合法原因。
 */
export type PlayResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };
