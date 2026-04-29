import { parsePlay, canBeat, calcMultiplier, isHandEmpty } from '../index';
import { Suit, Rank, CardPattern, MultiplierEvent } from '@doudizhu/types';
import type { Card, ParsedPlay } from '@doudizhu/types';

// ── 构造辅助函数 ──────────────────────────────────────────
function c(rank: Rank, suit: Suit = Suit.Spade): Card {
  return { rank, suit };
}

function parsed(pattern: CardPattern, rank: number, cards: Card[]): ParsedPlay {
  return { pattern, rank, cards };
}

// ── parsePlay ─────────────────────────────────────────────

describe('parsePlay - Single', () => {
  test('单张3', () => {
    const cards = [c(Rank.Three)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Single);
    expect(r?.rank).toBe(Rank.Three);
  });

  test('单张大王', () => {
    const cards = [c(Rank.BigJoker, Suit.Joker)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Single);
    expect(r?.rank).toBe(Rank.BigJoker);
  });
});

describe('parsePlay - Pair', () => {
  test('一对5', () => {
    const cards = [c(Rank.Five), c(Rank.Five, Suit.Heart)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Pair);
    expect(r?.rank).toBe(Rank.Five);
  });

  test('不同 rank 两张 → null', () => {
    expect(parsePlay([c(Rank.Three), c(Rank.Four)])).toBeNull();
  });
});

describe('parsePlay - Rocket', () => {
  test('小王+大王 → 火箭', () => {
    const cards = [c(Rank.SmallJoker, Suit.Joker), c(Rank.BigJoker, Suit.Joker)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Rocket);
    expect(r?.rank).toBe(0);
  });
});

describe('parsePlay - Triple', () => {
  test('三张8', () => {
    const cards = [c(Rank.Eight), c(Rank.Eight, Suit.Heart), c(Rank.Eight, Suit.Diamond)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Triple);
    expect(r?.rank).toBe(Rank.Eight);
  });
});

describe('parsePlay - Bomb', () => {
  test('四张K → 炸弹', () => {
    const cards = [c(Rank.King), c(Rank.King, Suit.Heart), c(Rank.King, Suit.Diamond), c(Rank.King, Suit.Club)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Bomb);
    expect(r?.rank).toBe(Rank.King);
  });
});

describe('parsePlay - TripleWithOne', () => {
  test('三带一', () => {
    const cards = [c(Rank.Seven), c(Rank.Seven, Suit.Heart), c(Rank.Seven, Suit.Diamond), c(Rank.Ace)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.TripleWithOne);
    expect(r?.rank).toBe(Rank.Seven);
  });

  test('4张不同 rank → null', () => {
    expect(parsePlay([c(Rank.Three), c(Rank.Four), c(Rank.Five), c(Rank.Six)])).toBeNull();
  });
});

describe('parsePlay - TripleWithPair', () => {
  test('三带一对', () => {
    const cards = [
      c(Rank.Ten), c(Rank.Ten, Suit.Heart), c(Rank.Ten, Suit.Diamond),
      c(Rank.Six), c(Rank.Six, Suit.Heart),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.TripleWithPair);
    expect(r?.rank).toBe(Rank.Ten);
  });
});

describe('parsePlay - Straight', () => {
  test('5张顺子 3-4-5-6-7', () => {
    const cards = [c(Rank.Three), c(Rank.Four), c(Rank.Five), c(Rank.Six), c(Rank.Seven)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Straight);
    expect(r?.rank).toBe(Rank.Three);
  });

  test('6张顺子 9-10-J-Q-K-A', () => {
    const cards = [c(Rank.Nine), c(Rank.Ten), c(Rank.Jack), c(Rank.Queen), c(Rank.King), c(Rank.Ace)];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Straight);
    expect(r?.rank).toBe(Rank.Nine);
  });

  test('含2的顺子 → null', () => {
    const cards = [c(Rank.Ten), c(Rank.Jack), c(Rank.Queen), c(Rank.King), c(Rank.Ace), c(Rank.Two)];
    expect(parsePlay(cards)).toBeNull();
  });

  test('不连续 → null', () => {
    const cards = [c(Rank.Three), c(Rank.Four), c(Rank.Six), c(Rank.Seven), c(Rank.Eight)];
    expect(parsePlay(cards)).toBeNull();
  });
});

describe('parsePlay - ConsecutivePairs', () => {
  test('3对连对 334455', () => {
    const cards = [
      c(Rank.Three), c(Rank.Three, Suit.Heart),
      c(Rank.Four),  c(Rank.Four, Suit.Heart),
      c(Rank.Five),  c(Rank.Five, Suit.Heart),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.ConsecutivePairs);
    expect(r?.rank).toBe(Rank.Three);
  });

  test('2对 → null（不够3对）', () => {
    const cards = [
      c(Rank.Three), c(Rank.Three, Suit.Heart),
      c(Rank.Four),  c(Rank.Four, Suit.Heart),
    ];
    expect(parsePlay(cards)).toBeNull();
  });
});

describe('parsePlay - FourWithTwo', () => {
  test('四带两单', () => {
    const cards = [
      c(Rank.Jack), c(Rank.Jack, Suit.Heart), c(Rank.Jack, Suit.Diamond), c(Rank.Jack, Suit.Club),
      c(Rank.Three), c(Rank.Seven),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.FourWithTwo);
    expect(r?.rank).toBe(Rank.Jack);
  });

  test('四带一对', () => {
    const cards = [
      c(Rank.Jack), c(Rank.Jack, Suit.Heart), c(Rank.Jack, Suit.Diamond), c(Rank.Jack, Suit.Club),
      c(Rank.Three), c(Rank.Three, Suit.Heart),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.FourWithTwo);
    expect(r?.rank).toBe(Rank.Jack);
  });
});

describe('parsePlay - Airplane', () => {
  test('两组三张 333444', () => {
    const cards = [
      c(Rank.Three), c(Rank.Three, Suit.Heart), c(Rank.Three, Suit.Diamond),
      c(Rank.Four),  c(Rank.Four, Suit.Heart),  c(Rank.Four, Suit.Diamond),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Airplane);
    expect(r?.rank).toBe(Rank.Three);
  });

  test('三组三张', () => {
    const cards = [
      c(Rank.Five), c(Rank.Five, Suit.Heart), c(Rank.Five, Suit.Diamond),
      c(Rank.Six),  c(Rank.Six, Suit.Heart),  c(Rank.Six, Suit.Diamond),
      c(Rank.Seven),c(Rank.Seven, Suit.Heart), c(Rank.Seven, Suit.Diamond),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.Airplane);
    expect(r?.rank).toBe(Rank.Five);
  });
});

describe('parsePlay - AirplaneWithWings', () => {
  test('飞机带单（2组三+2单）', () => {
    const cards = [
      c(Rank.Three), c(Rank.Three, Suit.Heart), c(Rank.Three, Suit.Diamond),
      c(Rank.Four),  c(Rank.Four, Suit.Heart),  c(Rank.Four, Suit.Diamond),
      c(Rank.Nine),  c(Rank.King),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.AirplaneWithWings);
    expect(r?.rank).toBe(Rank.Three);
  });

  test('飞机带对（2组三+2对）', () => {
    const cards = [
      c(Rank.Three), c(Rank.Three, Suit.Heart), c(Rank.Three, Suit.Diamond),
      c(Rank.Four),  c(Rank.Four, Suit.Heart),  c(Rank.Four, Suit.Diamond),
      c(Rank.Nine),  c(Rank.Nine, Suit.Heart),
      c(Rank.King),  c(Rank.King, Suit.Heart),
    ];
    const r = parsePlay(cards);
    expect(r?.pattern).toBe(CardPattern.AirplaneWithWings);
    expect(r?.rank).toBe(Rank.Three);
  });
});

describe('parsePlay - null cases', () => {
  test('空数组 → null', () => {
    expect(parsePlay([])).toBeNull();
  });

  test('两张不同 rank → null', () => {
    expect(parsePlay([c(Rank.Three), c(Rank.Five)])).toBeNull();
  });
});

// ── canBeat ───────────────────────────────────────────────

describe('canBeat', () => {
  const single3  = parsePlay([c(Rank.Three)])!;
  const single5  = parsePlay([c(Rank.Five)])!;
  const pair3    = parsePlay([c(Rank.Three), c(Rank.Three, Suit.Heart)])!;
  const pair5    = parsePlay([c(Rank.Five),  c(Rank.Five, Suit.Heart)])!;
  const bomb3    = parsePlay([c(Rank.Three), c(Rank.Three, Suit.Heart), c(Rank.Three, Suit.Diamond), c(Rank.Three, Suit.Club)])!;
  const bombK    = parsePlay([c(Rank.King),  c(Rank.King, Suit.Heart),  c(Rank.King, Suit.Diamond),  c(Rank.King, Suit.Club)])!;
  const rocket   = parsePlay([c(Rank.SmallJoker, Suit.Joker), c(Rank.BigJoker, Suit.Joker)])!;

  test('last=null → true（首出）', () => {
    expect(canBeat(single3, null)).toBe(true);
  });

  test('单张5打单张3 → true', () => {
    expect(canBeat(single5, single3)).toBe(true);
  });

  test('单张3打单张5 → false', () => {
    expect(canBeat(single3, single5)).toBe(false);
  });

  test('单张打对子 → false', () => {
    expect(canBeat(single5, pair3)).toBe(false);
  });

  test('对5打对3 → true', () => {
    expect(canBeat(pair5, pair3)).toBe(true);
  });

  test('炸弹打单张 → true', () => {
    expect(canBeat(bomb3, single5)).toBe(true);
  });

  test('炸弹K打炸弹3 → true', () => {
    expect(canBeat(bombK, bomb3)).toBe(true);
  });

  test('炸弹3打炸弹K → false', () => {
    expect(canBeat(bomb3, bombK)).toBe(false);
  });

  test('火箭打任意 → true', () => {
    expect(canBeat(rocket, bombK)).toBe(true);
  });

  test('任意打火箭 → false', () => {
    expect(canBeat(bombK, rocket)).toBe(false);
    expect(canBeat(single5, rocket)).toBe(false);
  });

  test('不同张数顺子 → false', () => {
    const s5 = parsePlay([c(Rank.Three), c(Rank.Four), c(Rank.Five), c(Rank.Six), c(Rank.Seven)])!;
    const s6 = parsePlay([c(Rank.Three), c(Rank.Four), c(Rank.Five), c(Rank.Six), c(Rank.Seven), c(Rank.Eight)])!;
    expect(canBeat(s6, s5)).toBe(false);
  });
});

// ── calcMultiplier ────────────────────────────────────────

describe('calcMultiplier', () => {
  test('无事件 → 1', () => {
    expect(calcMultiplier([])).toBe(1);
  });

  test('叫地主（×1）', () => {
    expect(calcMultiplier([MultiplierEvent.BidLandlord])).toBe(1);
  });

  test('明牌（×2）', () => {
    expect(calcMultiplier([MultiplierEvent.ShowCards])).toBe(2);
  });

  test('炸弹+炸弹+春天 → 1×2×2×2=8', () => {
    expect(calcMultiplier([
      MultiplierEvent.Bomb,
      MultiplierEvent.Bomb,
      MultiplierEvent.Spring,
    ])).toBe(8);
  });

  test('叫地主+明牌+加倍 → 1×1×2×2=4', () => {
    expect(calcMultiplier([
      MultiplierEvent.BidLandlord,
      MultiplierEvent.ShowCards,
      MultiplierEvent.Double,
    ])).toBe(4);
  });

  test('反春天（×2）', () => {
    expect(calcMultiplier([MultiplierEvent.AntiSpring])).toBe(2);
  });
});

// ── isHandEmpty ───────────────────────────────────────────

describe('isHandEmpty', () => {
  test('空手牌 → true', () => {
    expect(isHandEmpty([])).toBe(true);
  });

  test('有牌 → false', () => {
    expect(isHandEmpty([c(Rank.Three)])).toBe(false);
  });
});
