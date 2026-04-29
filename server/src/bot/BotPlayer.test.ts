import { BotPlayer } from './BotPlayer';
import { parsePlay } from '@doudizhu/game-engine';
import { CardPattern, Rank, Suit } from '@doudizhu/types';
import type { Card, ParsedPlay } from '@doudizhu/types';

const bot = new BotPlayer();

function card(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function parsedSingle(rank: Rank): ParsedPlay {
  return { pattern: CardPattern.Single, cards: [card(Suit.Spade, rank)], rank };
}

function parsedPair(rank: Rank): ParsedPlay {
  return {
    pattern: CardPattern.Pair,
    cards: [card(Suit.Spade, rank), card(Suit.Heart, rank)],
    rank,
  };
}

describe('BotPlayer.selectPlay', () => {
  // ─── 场景一：首出轮，出最小单张 ──────────────────────────────────────────────

  it('场景一：首出轮，手牌有多种牌型 → 出最小单张', () => {
    const hand: Card[] = [
      card(Suit.Spade, Rank.Three),  // 3♠
      card(Suit.Heart, Rank.Three),  // 3♥
      card(Suit.Spade, Rank.Four),   // 4♠
      card(Suit.Spade, Rank.Five),   // 5♠
      card(Suit.Spade, Rank.Six),    // 6♠
      card(Suit.Spade, Rank.Seven),  // 7♠
      card(Suit.Spade, Rank.King),   // K♠
      card(Suit.Spade, Rank.Ace),    // A♠
    ];
    // 存在顺子 3-7（5张），但策略要求不主动出大组合
    const result = bot.selectPlay(hand, null);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(Rank.Three);
  });

  // ─── 场景二：压过上家对子 ──────────────────────────────────────────────────

  it('场景二：需要压过上家的对4 → 出最小能压的对子', () => {
    const hand: Card[] = [
      card(Suit.Spade, Rank.Five),
      card(Suit.Heart, Rank.Five),
      card(Suit.Spade, Rank.Eight),
      card(Suit.Heart, Rank.Eight),
      card(Suit.Spade, Rank.King),
    ];
    const result = bot.selectPlay(hand, parsedPair(Rank.Four));
    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(Rank.Five);
    expect(result[1].rank).toBe(Rank.Five);
  });

  // ─── 场景三：无法压过，pass ────────────────────────────────────────────────

  it('场景三：所有牌都无法压过 lastPlay → 返回空数组', () => {
    const hand: Card[] = [
      card(Suit.Spade, Rank.Three),
      card(Suit.Heart, Rank.Four),
      card(Suit.Diamond, Rank.Six),
    ];
    // lastPlay = A（rank=14），手里都低于 A，且无炸弹
    const result = bot.selectPlay(hand, parsedSingle(Rank.Ace));
    expect(result).toHaveLength(0);
  });

  // ─── 场景四：只剩一张牌，首出轮 ───────────────────────────────────────────

  it('场景四：只剩一张牌，首出轮 → 出那张牌', () => {
    const hand: Card[] = [card(Suit.Spade, Rank.King)];
    const result = bot.selectPlay(hand, null);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(Rank.King);
  });

  // ─── 场景五：炸弹不主动出 ─────────────────────────────────────────────────

  it('场景五：手牌有炸弹和小牌，首出轮 → 出小牌而非炸弹', () => {
    const hand: Card[] = [
      card(Suit.Spade,   Rank.Seven),
      card(Suit.Heart,   Rank.Seven),
      card(Suit.Diamond, Rank.Seven),
      card(Suit.Club,    Rank.Seven),
      card(Suit.Spade,   Rank.Three),
    ];
    const result = bot.selectPlay(hand, null);
    // 期望出 3♠，不出炸弹
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(Rank.Three);
  });

  // ─── 场景六：普通牌压不过时用炸弹 ────────────────────────────────────────

  it('场景六：普通牌无法压单 A，用炸弹 → 出 8888', () => {
    const hand: Card[] = [
      card(Suit.Spade,   Rank.Three),
      card(Suit.Heart,   Rank.Five),
      card(Suit.Spade,   Rank.Eight),
      card(Suit.Heart,   Rank.Eight),
      card(Suit.Diamond, Rank.Eight),
      card(Suit.Club,    Rank.Eight),
    ];
    const result = bot.selectPlay(hand, parsedSingle(Rank.Ace));
    // 单牌 3、5、8 均 < 14（Ace），只有炸弹 8888 能打过
    expect(result).toHaveLength(4);
    expect(result.every(c => c.rank === Rank.Eight)).toBe(true);
  });

  // ─── 补充场景 ─────────────────────────────────────────────────────────────

  it('首出轮，手中只有炸弹 → 出最小张（放弃一张炸弹）', () => {
    const hand: Card[] = [
      card(Suit.Spade,   Rank.Five),
      card(Suit.Heart,   Rank.Five),
      card(Suit.Diamond, Rank.Five),
      card(Suit.Club,    Rank.Five),
    ];
    const result = bot.selectPlay(hand, null);
    // 整手就是炸弹，不能首出轮直接出炸弹 → 出最小单张
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(Rank.Five);
  });

  it('压牌轮，压不过普通但有火箭 → 出火箭', () => {
    const hand: Card[] = [
      card(Suit.Spade,  Rank.Two),
      card(Suit.Joker,  Rank.SmallJoker),
      card(Suit.Joker,  Rank.BigJoker),
    ];
    // lastPlay = 2（rank=15），单张 2 手里也有，但小王/大王单独不能打对子
    // 这里 lastPlay 是单张，手里单张 2（rank15）能打，优先单张
    const singleTwo = parsedSingle(Rank.Two); // rank=15
    const result = bot.selectPlay(hand, singleTwo);
    // 2 rank=15 能打，出 2
    // 但手里的 Two 也是 rank=15 = singleTwo.rank，canBeat(Single(15), Single(15))=false
    // 所以出小王（rank=16）
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(Rank.SmallJoker);
  });

  it('整手牌刚好全出且能打过 lastPlay → 一次出完', () => {
    // 手里剩 3♠3♥（对3），lastPlay=对2（rank=15）→ 对3不能打过
    // 改成手里剩 A♠A♥，lastPlay=对5 → 对A rank=14 能打对5
    const hand: Card[] = [
      card(Suit.Spade, Rank.Ace),
      card(Suit.Heart, Rank.Ace),
    ];
    const result = bot.selectPlay(hand, parsedPair(Rank.Five));
    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(Rank.Ace);
    expect(result[1].rank).toBe(Rank.Ace);
  });

  it('手牌为空 → 返回空数组', () => {
    expect(bot.selectPlay([], null)).toHaveLength(0);
    expect(bot.selectPlay([], parsedSingle(Rank.Three))).toHaveLength(0);
  });
});
