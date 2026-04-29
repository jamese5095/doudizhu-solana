import { MultiplierEvent, MULTIPLIER_FACTORS } from '../types';
import type { Card } from '../types';

/**
 * 计算最终倍率。
 * 初始倍率为 1，每个事件依次乘以对应因子。
 * 结果始终为正整数。
 */
export function calcMultiplier(events: readonly MultiplierEvent[]): number {
  let multiplier = 1;
  for (const event of events) {
    multiplier *= MULTIPLIER_FACTORS[event];
  }
  return multiplier;
}

/**
 * 判断手牌是否已全部出完（手牌为空 → 赢）。
 */
export function isHandEmpty(hand: readonly Card[]): boolean {
  return hand.length === 0;
}
