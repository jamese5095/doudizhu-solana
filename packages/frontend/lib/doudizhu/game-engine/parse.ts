import type { Card, ParsedPlay } from '../types';
import { CardPattern, Rank } from '../types';
import {
  rankCounts,
  uniqueRanksSorted,
  isConsecutiveRanks,
  allSequenceEligible,
} from './utils';

/**
 * 解析出牌，返回 ParsedPlay 或 null（非法牌型）。
 *
 * rank 字段含义：
 *  - Single/Pair/Triple/Bomb: 该牌的 Rank 值
 *  - Rocket: 0（特殊，永远最大）
 *  - TripleWithOne/TripleWithPair: 三张那组的 Rank 值
 *  - Straight/ConsecutivePairs/Airplane/AirplaneWithWings: 最低牌的 Rank 值
 *  - FourWithTwo: 四张那组的 Rank 值
 */
export function parsePlay(cards: readonly Card[]): ParsedPlay | null {
  const n = cards.length;
  if (n === 0) return null;

  const counts = rankCounts(cards);
  const uniq = uniqueRanksSorted(counts);
  const maxCount = Math.max(...counts.values());

  // ── 单张 ──────────────────────────────────────────────
  if (n === 1) {
    return { pattern: CardPattern.Single, cards, rank: cards[0].rank };
  }

  // ── 2张 ──────────────────────────────────────────────
  if (n === 2) {
    // 火箭：小王+大王
    if (
      counts.get(Rank.SmallJoker) === 1 &&
      counts.get(Rank.BigJoker) === 1
    ) {
      return { pattern: CardPattern.Rocket, cards, rank: 0 };
    }
    // 对子
    if (maxCount === 2 && uniq.length === 1) {
      return { pattern: CardPattern.Pair, cards, rank: uniq[0] };
    }
    return null;
  }

  // ── 3张 ──────────────────────────────────────────────
  if (n === 3) {
    if (maxCount === 3) {
      return { pattern: CardPattern.Triple, cards, rank: uniq[0] };
    }
    return null;
  }

  // ── 4张 ──────────────────────────────────────────────
  if (n === 4) {
    // 炸弹
    if (maxCount === 4) {
      return { pattern: CardPattern.Bomb, cards, rank: uniq[0] };
    }
    // 三带一
    if (maxCount === 3 && uniq.length === 2) {
      const tripleRank = uniq.find(r => counts.get(r) === 3)!;
      return { pattern: CardPattern.TripleWithOne, cards, rank: tripleRank };
    }
    return null;
  }

  // ── 5张 ──────────────────────────────────────────────
  if (n === 5) {
    // 三带一对
    if (maxCount === 3 && uniq.length === 2) {
      const tripleRank = uniq.find(r => counts.get(r) === 3)!;
      const pairRank   = uniq.find(r => counts.get(r) === 2)!;
      if (pairRank !== undefined) {
        return { pattern: CardPattern.TripleWithPair, cards, rank: tripleRank };
      }
    }
    // 顺子（5张）：5张不同 rank，连续，最大不超过 A
    if (maxCount === 1 && uniq.length === 5 && isConsecutiveRanks(uniq) && allSequenceEligible(uniq)) {
      return { pattern: CardPattern.Straight, cards, rank: uniq[0] };
    }
    return null;
  }

  // ── 6张及以上 ─────────────────────────────────────────
  // 顺子（6-12张）
  if (n >= 6 && n <= 12 && maxCount === 1 && uniq.length === n) {
    if (isConsecutiveRanks(uniq) && allSequenceEligible(uniq)) {
      return { pattern: CardPattern.Straight, cards, rank: uniq[0] };
    }
  }

  // 连对（≥3对）：n 为偶数，每个 rank 恰好 2 张，连续，最大不超过 A
  if (n >= 6 && n % 2 === 0) {
    const pairCount = n / 2;
    if (
      pairCount >= 3 &&
      uniq.length === pairCount &&
      [...counts.values()].every(c => c === 2) &&
      isConsecutiveRanks(uniq) &&
      allSequenceEligible(uniq)
    ) {
      return { pattern: CardPattern.ConsecutivePairs, cards, rank: uniq[0] };
    }
  }

  // 四带二（6张）：4+1+1 或 4+2
  if (n === 6 && maxCount === 4) {
    return { pattern: CardPattern.FourWithTwo, cards, rank: uniq.find(r => counts.get(r) === 4)! };
  }

  // 飞机系列：先找出所有连续三张的组
  const tripleRanks = uniq.filter(r => counts.get(r) === 3);
  if (tripleRanks.length >= 2 && isConsecutiveRanks(tripleRanks) && allSequenceEligible(tripleRanks)) {
    const planeSize = tripleRanks.length; // 几组三张
    const wingTotal = n - planeSize * 3;  // 翅膀总张数

    // 飞机不带翅膀
    if (wingTotal === 0) {
      return { pattern: CardPattern.Airplane, cards, rank: tripleRanks[0] };
    }

    // 飞机带单翅（每组带一张）：翅膀数 = planeSize
    if (wingTotal === planeSize) {
      return { pattern: CardPattern.AirplaneWithWings, cards, rank: tripleRanks[0] };
    }

    // 飞机带对翅（每组带一对）：翅膀数 = planeSize * 2
    if (wingTotal === planeSize * 2) {
      // 验证翅膀部分都以对出现（非三张自身）
      const wingRanks = uniq.filter(r => !tripleRanks.includes(r));
      if (wingRanks.every(r => counts.get(r) === 2)) {
        return { pattern: CardPattern.AirplaneWithWings, cards, rank: tripleRanks[0] };
      }
    }
  }

  return null;
}
