/**
 * BotPlayer — 托管机器人选牌策略（智能版）
 *
 * 首出策略：优先出孤立单牌 → 最小对子 → 最小非炸弹单张
 * 压牌策略：支持所有牌型（顺子/连对/飞机/三带/四带）最小够压的组合
 * 叫地主策略：基于手牌强度评分，≥8 分叫地主
 */

import { parsePlay, canBeat } from '@doudizhu/game-engine';
import { CardPattern, Rank } from '@doudizhu/types';
import type { Card, ParsedPlay } from '@doudizhu/types';

const ACE = Rank.Ace as number; // 14，顺子最大到 A

export class BotPlayer {
  // ─── 公开 API ──────────────────────────────────────────────────────────────

  selectPlay(hand: readonly Card[], lastPlay: ParsedPlay | null): Card[] {
    if (hand.length === 0) return [];

    // 整手牌构成合法牌型且能压过 → 出完（首出轮排除炸弹/火箭）
    const wholePlay = parsePlay(hand);
    if (wholePlay !== null && canBeat(wholePlay, lastPlay)) {
      if (lastPlay !== null || this.isLegalFirstBurst(wholePlay)) return [...hand];
    }

    return lastPlay === null ? this.firstPlay(hand) : this.beatPlay(hand, lastPlay);
  }

  /** 是否叫地主：手牌强度评分 ≥ 8 分 */
  shouldBid(hand: readonly Card[]): boolean {
    let score = 0;
    const groups = this.rankGroups(hand);
    for (const [rank, cards] of groups) {
      if      (rank === Rank.Two)       score += 3 * cards.length;
      else if (rank === Rank.Ace)       score += 2 * cards.length;
      else if (rank === Rank.King)      score += 1 * cards.length;
      else if (rank === Rank.SmallJoker) score += 3;
      else if (rank === Rank.BigJoker)   score += 4;
      if (cards.length === 4)           score += 4; // 炸弹加分
    }
    return score >= 8;
  }

  // ─── 首出轮 ────────────────────────────────────────────────────────────────

  private firstPlay(hand: readonly Card[]): Card[] {
    if (hand.length === 1) return [...hand];

    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    const groups = this.rankGroups(hand);

    // 1. 孤立单牌（只有 1 张该 rank，不是王牌）
    for (const card of sorted) {
      if (card.rank === Rank.SmallJoker || card.rank === Rank.BigJoker) continue;
      if ((groups.get(card.rank) ?? []).length === 1) return [card];
    }

    // 2. 最小对子（整对出，不拆）
    for (const [, cards] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      if (cards.length === 2) return [...cards];
    }

    // 3. 最小非炸弹单张（退化为保守策略）
    for (const card of sorted) {
      if (card.rank === Rank.SmallJoker || card.rank === Rank.BigJoker) continue;
      if ((groups.get(card.rank) ?? []).length < 4) return [card];
    }

    // 4. 最后防线：出最小非王单张
    for (const card of sorted) {
      if (card.rank !== Rank.SmallJoker && card.rank !== Rank.BigJoker) return [card];
    }

    const small = hand.find(c => c.rank === Rank.SmallJoker);
    return small !== undefined ? [small] : [...hand];
  }

  // ─── 压牌轮 ────────────────────────────────────────────────────────────────

  private beatPlay(hand: readonly Card[], lastPlay: ParsedPlay): Card[] {
    const normal = this.samePatternCandidates(hand, lastPlay).filter(
      p => p.pattern !== CardPattern.Bomb && p.pattern !== CardPattern.Rocket,
    );
    if (normal.length > 0) return [...normal[0].cards];

    const bombs = this.bombCandidates(hand, lastPlay);
    if (bombs.length > 0) return [...bombs[0].cards];

    return [];
  }

  // ─── 同牌型候选生成 ────────────────────────────────────────────────────────

  private samePatternCandidates(hand: readonly Card[], lastPlay: ParsedPlay): ParsedPlay[] {
    const results: ParsedPlay[] = [];
    const groups = this.rankGroups(hand);

    switch (lastPlay.pattern) {

      case CardPattern.Single:
        for (const card of hand) {
          const p = parsePlay([card]);
          if (p && canBeat(p, lastPlay)) results.push(p);
        }
        break;

      case CardPattern.Pair:
        for (const [, cards] of groups) {
          if (cards.length >= 2) {
            const p = parsePlay(cards.slice(0, 2));
            if (p && canBeat(p, lastPlay)) results.push(p);
          }
        }
        break;

      case CardPattern.Triple:
        for (const [, cards] of groups) {
          if (cards.length >= 3) {
            const p = parsePlay(cards.slice(0, 3));
            if (p && canBeat(p, lastPlay)) results.push(p);
          }
        }
        break;

      case CardPattern.TripleWithOne:
        for (const [rank, cards] of groups) {
          if (rank <= lastPlay.rank || cards.length < 3) continue;
          const triple = cards.slice(0, 3);
          // 找一张不同 rank 的单牌作为踢牌
          const kicker = hand.find(c => c.rank !== rank);
          if (!kicker) continue;
          const p = parsePlay([...triple, kicker]);
          if (p && canBeat(p, lastPlay)) results.push(p);
        }
        break;

      case CardPattern.TripleWithPair:
        for (const [rank, cards] of groups) {
          if (rank <= lastPlay.rank || cards.length < 3) continue;
          const triple = cards.slice(0, 3);
          // 找任意对子作为踢牌
          for (const [pairRank, pairCards] of groups) {
            if (pairRank === rank || pairCards.length < 2) continue;
            const p = parsePlay([...triple, ...pairCards.slice(0, 2)]);
            if (p && canBeat(p, lastPlay)) { results.push(p); break; }
          }
        }
        break;

      case CardPattern.Straight: {
        const len = lastPlay.cards.length;
        for (let start = lastPlay.rank + 1; start + len - 1 <= ACE; start++) {
          const combo: Card[] = [];
          let ok = true;
          for (let r = start; r < start + len; r++) {
            const g = groups.get(r);
            if (!g?.length) { ok = false; break; }
            combo.push(g[0]);
          }
          if (!ok) continue;
          const p = parsePlay(combo);
          if (p && canBeat(p, lastPlay)) { results.push(p); break; }
        }
        break;
      }

      case CardPattern.ConsecutivePairs: {
        const pairCount = lastPlay.cards.length / 2;
        for (let start = lastPlay.rank + 1; start + pairCount - 1 <= ACE; start++) {
          const combo: Card[] = [];
          let ok = true;
          for (let r = start; r < start + pairCount; r++) {
            const g = groups.get(r);
            if (!g || g.length < 2) { ok = false; break; }
            combo.push(g[0], g[1]);
          }
          if (!ok) continue;
          const p = parsePlay(combo);
          if (p && canBeat(p, lastPlay)) { results.push(p); break; }
        }
        break;
      }

      case CardPattern.Airplane: {
        const tripleCount = Math.floor(lastPlay.cards.length / 3);
        for (let start = lastPlay.rank + 1; start + tripleCount - 1 <= ACE; start++) {
          const combo: Card[] = [];
          let ok = true;
          for (let r = start; r < start + tripleCount; r++) {
            const g = groups.get(r);
            if (!g || g.length < 3) { ok = false; break; }
            combo.push(...g.slice(0, 3));
          }
          if (!ok) continue;
          const p = parsePlay(combo);
          if (p && canBeat(p, lastPlay)) { results.push(p); break; }
        }
        break;
      }

      case CardPattern.AirplaneWithWings: {
        // 从 lastPlay.cards 推断飞机数量和翅膀类型
        const lastRankMap = new Map<number, number>();
        for (const c of lastPlay.cards) {
          lastRankMap.set(c.rank, (lastRankMap.get(c.rank) ?? 0) + 1);
        }
        const tripleCount = [...lastRankMap.values()].filter(c => c >= 3).length;
        const wingTotal   = lastPlay.cards.length - tripleCount * 3;
        const singleWings = wingTotal === tripleCount;      // 飞机带单
        const pairWings   = wingTotal === tripleCount * 2;  // 飞机带对
        if (!singleWings && !pairWings) break;

        for (let start = lastPlay.rank + 1; start + tripleCount - 1 <= ACE; start++) {
          const airRanks = new Set(
            Array.from({ length: tripleCount }, (_, i) => start + i),
          );
          // 构建飞机部分
          const airCombo: Card[] = [];
          let ok = true;
          for (const r of airRanks) {
            const g = groups.get(r);
            if (!g || g.length < 3) { ok = false; break; }
            airCombo.push(...g.slice(0, 3));
          }
          if (!ok) continue;

          // 收集翅膀候选牌池
          const wingPool: Card[] = [];
          for (const [rank, cards] of groups) {
            wingPool.push(...(airRanks.has(rank) ? cards.slice(3) : cards));
          }

          let wings: Card[] = [];
          if (singleWings) {
            if (wingPool.length < tripleCount) continue;
            wings = wingPool.slice(0, tripleCount);
          } else {
            // 找足够多的对子作翅膀
            const wingGroupMap = this.rankGroups(wingPool);
            let wingsFound = 0;
            for (const [, wCards] of [...wingGroupMap.entries()].sort((a, b) => a[0] - b[0])) {
              if (wCards.length >= 2 && wingsFound < tripleCount) {
                wings.push(...wCards.slice(0, 2));
                wingsFound++;
              }
            }
            if (wingsFound < tripleCount) continue;
          }

          const p = parsePlay([...airCombo, ...wings]);
          if (p && canBeat(p, lastPlay)) { results.push(p); break; }
        }
        break;
      }

      case CardPattern.FourWithTwo:
        for (const [rank, cards] of groups) {
          if (rank <= lastPlay.rank || cards.length < 4) continue;
          const quad = cards.slice(0, 4);
          const kickers: Card[] = [];
          for (const c of hand) {
            if (c.rank !== rank && kickers.length < 2) kickers.push(c);
          }
          if (kickers.length < 2) continue;
          const p = parsePlay([...quad, ...kickers]);
          if (p && canBeat(p, lastPlay)) results.push(p);
        }
        break;

      case CardPattern.Bomb:
        for (const [, cards] of groups) {
          if (cards.length >= 4) {
            const p = parsePlay(cards.slice(0, 4));
            if (p && canBeat(p, lastPlay)) results.push(p);
          }
        }
        break;

      default:
        break;
    }

    results.sort((a, b) => a.rank - b.rank);
    return results;
  }

  private bombCandidates(hand: readonly Card[], lastPlay: ParsedPlay): ParsedPlay[] {
    const results: ParsedPlay[] = [];
    const groups = this.rankGroups(hand);

    for (const [, cards] of groups) {
      if (cards.length >= 4) {
        const p = parsePlay(cards.slice(0, 4));
        if (p && canBeat(p, lastPlay)) results.push(p);
      }
    }

    const small = hand.find(c => c.rank === Rank.SmallJoker);
    const big   = hand.find(c => c.rank === Rank.BigJoker);
    if (small && big) {
      const rocket = parsePlay([small, big]);
      if (rocket && canBeat(rocket, lastPlay)) results.push(rocket);
    }

    results.sort((a, b) => a.rank - b.rank);
    return results;
  }

  // ─── 工具 ─────────────────────────────────────────────────────────────────

  private rankGroups(hand: readonly Card[]): Map<number, Card[]> {
    const map = new Map<number, Card[]>();
    for (const card of hand) {
      if (!map.has(card.rank)) map.set(card.rank, []);
      map.get(card.rank)!.push(card);
    }
    return map;
  }

  private isLegalFirstBurst(play: ParsedPlay): boolean {
    return play.pattern !== CardPattern.Bomb && play.pattern !== CardPattern.Rocket;
  }
}
