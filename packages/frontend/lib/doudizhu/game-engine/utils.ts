import type { Card } from '../types';
import { Rank } from '../types';

/** 将手牌按 rank 升序排列 */
export function sortedRanks(cards: readonly Card[]): number[] {
  return cards.map(c => c.rank).sort((a, b) => a - b);
}

/**
 * 统计每个 rank 出现的次数
 * 返回 Map<rank, count>
 */
export function rankCounts(cards: readonly Card[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cards) {
    m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  }
  return m;
}

/** 返回升序排列的不重复 rank 列表 */
export function uniqueRanksSorted(counts: Map<number, number>): number[] {
  return [...counts.keys()].sort((a, b) => a - b);
}

/**
 * 检查给定 ranks（已升序）是否连续（每相邻差为1）
 * ranks 长度至少为 2
 */
export function isConsecutiveRanks(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] - ranks[i - 1] !== 1) return false;
  }
  return true;
}

/**
 * 检查所有 rank 均不超过 Ace（14），即不含 2、小王、大王
 * 用于顺子 / 连对 / 飞机等合法性验证
 */
export function allSequenceEligible(ranks: number[]): boolean {
  return ranks.every(r => r <= Rank.Ace);
}
