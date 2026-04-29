import { GameStateMachine, type GameOverPayload, type BotActionPayload } from './GameStateMachine';
import type { BotPlayer } from '../bot/BotPlayer';
import { TimeoutManager } from './TimeoutManager';
import type { RoomManager } from '../room/RoomManager';
import {
  type GameState,
  type PlayerState,
  type Card,
  GamePhase,
  PlayerRole,
  BetTier,
  Suit,
  Rank,
} from '@doudizhu/types';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/** 最小化 RoomManager mock，内部用 Map 维护 state */
function makeRM(initial: GameState): {
  rm: RoomManager;
  getState: () => GameState;
} {
  let stored = initial;
  const rm = {
    getRoom: jest.fn().mockImplementation(async () => stored),
    updateRoom: jest.fn().mockImplementation(async (_id: string, s: GameState) => {
      stored = s;
    }),
    createRoom: jest.fn(),
    deleteRoom: jest.fn(),
    getPlayerRoom: jest.fn(),
  } as unknown as RoomManager;
  return { rm, getState: () => stored };
}

/** TimeoutManager mock（不触发真实 setTimeout） */
function makeTimeout(): TimeoutManager {
  return {
    startTimer: jest.fn(),
    clearTimer: jest.fn(),
    clearAll: jest.fn(),
  } as unknown as TimeoutManager;
}

// ─── Card helpers ─────────────────────────────────────────────────────────────

const ALL_NORMAL_RANKS: Rank[] = [
  Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
  Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace, Rank.Two,
];

/** 生成指定花色的 17 张牌（13 张该花色 + 4 张下一花色低点） */
function hand17(suit: Suit): Card[] {
  const next = ((suit + 1) % 4) as Suit;
  return [
    ...ALL_NORMAL_RANKS.map(rank => ({ suit, rank })),
    ...ALL_NORMAL_RANKS.slice(0, 4).map(rank => ({ suit: next, rank })),
  ];
}

/** 生成指定花色的 20 张牌（地主初始手牌量） */
function hand20(suit: Suit): Card[] {
  const next = ((suit + 1) % 4) as Suit;
  return [
    ...ALL_NORMAL_RANKS.map(rank => ({ suit, rank })),
    ...ALL_NORMAL_RANKS.slice(0, 7).map(rank => ({ suit: next, rank })),
  ];
}

// ─── State factories ──────────────────────────────────────────────────────────

const BASE: Omit<GameState, 'phase' | 'players' | 'currentTurnIndex' | 'lastPlay' | 'lastPlayerId'> = {
  roomId: 'test-room',
  landlordIndex: 0,
  kitty: [],
  multiplier: 1,
  winnerId: null,
  betTier: BetTier.Small,
  biddingPassCount: 0,
};

function player(id: string, handCards: Card[] = [], role = PlayerRole.Farmer): PlayerState {
  return { playerId: id, role, handCards, isReady: true };
}

const P = ['player-0', 'player-1', 'player-2'] as const;

/** 生成一个处于 Playing 阶段的 GameState */
function playingState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...BASE,
    phase: GamePhase.Playing,
    currentTurnIndex: 0,
    lastPlay: null,
    lastPlayerId: null,
    players: [
      player(P[0], [{ suit: Suit.Spade, rank: Rank.Three }], PlayerRole.Landlord),
      player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
      player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
    ],
    ...overrides,
  };
}

/** 生成一个处于 Bidding 阶段的 GameState（每人 1 张，方便测试）*/
function biddingState(): GameState {
  return {
    ...BASE,
    phase: GamePhase.Bidding,
    currentTurnIndex: 0,
    lastPlay: null,
    lastPlayerId: null,
    players: [
      player(P[0], [{ suit: Suit.Spade, rank: Rank.Three }]),
      player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
      player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GameStateMachine', () => {
  describe('handlePlay — 合法出牌', () => {
    it('出牌后 currentTurnIndex 正确切换到下一玩家', async () => {
      const state = playingState();
      const { rm } = makeRM(state);
      const sm = new GameStateMachine(rm, makeTimeout());

      const card: Card = { suit: Suit.Spade, rank: Rank.Three };
      // 给 player-0 两张牌，出一张后仍有牌（不触发 gameOver）
      const richState = playingState({
        players: [
          player(P[0], [card, { suit: Suit.Club, rank: Rank.Three }], PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
      });
      const { rm: rm2, getState } = makeRM(richState);
      const sm2 = new GameStateMachine(rm2, makeTimeout());

      const { state: next, error } = await sm2.handlePlay('test-room', P[0], [card]);
      expect(error).toBeUndefined();
      expect(next.currentTurnIndex).toBe(1);
      expect(getState().currentTurnIndex).toBe(1);
    });

    it('出牌后 lastPlay 和 lastPlayerId 正确更新', async () => {
      const card: Card = { suit: Suit.Spade, rank: Rank.Ace };
      const s = playingState({
        players: [
          player(P[0], [card, { suit: Suit.Club, rank: Rank.Three }], PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const { state: next } = await sm.handlePlay('test-room', P[0], [card]);
      expect(next.lastPlayerId).toBe(P[0]);
      expect(next.lastPlay?.rank).toBe(Rank.Ace);
    });
  });

  describe('handlePlay — 非法出牌', () => {
    it('压不过上家时返回 error，状态不变', async () => {
      // player-1 的手牌是 Three，lastPlay 是 Ace（Single）
      const lastPlayCard: Card = { suit: Suit.Spade, rank: Rank.Ace };
      const weakCard: Card = { suit: Suit.Heart, rank: Rank.Three };

      const s = playingState({
        currentTurnIndex: 1,
        lastPlay: { pattern: 'Single' as any, cards: [lastPlayCard], rank: Rank.Ace },
        lastPlayerId: P[0],
        players: [
          player(P[0], [lastPlayCard], PlayerRole.Landlord),
          player(P[1], [weakCard]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
      });
      const { rm, getState } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const { state: next, error } = await sm.handlePlay('test-room', P[1], [weakCard]);
      expect(error).toBe('Cannot beat the last play');
      // state 应与初始完全一致（updateRoom 未被调用）
      expect(getState()).toEqual(s);
      expect(next).toEqual(s);
    });

    it('非法牌型（如单出 2 张不同花色）返回 error', async () => {
      const cards: Card[] = [
        { suit: Suit.Spade, rank: Rank.Three },
        { suit: Suit.Heart, rank: Rank.Four },
      ];
      const s = playingState({
        players: [
          player(P[0], cards, PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Diamond, rank: Rank.Five }]),
          player(P[2], [{ suit: Suit.Club, rank: Rank.Six }]),
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const { error } = await sm.handlePlay('test-room', P[0], cards);
      expect(error).toBe('Invalid card combination');
    });

    it('手牌中没有该牌时返回 error', async () => {
      const s = playingState();
      const { rm, getState } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const notInHand: Card = { suit: Suit.Club, rank: Rank.King };
      const { error } = await sm.handlePlay('test-room', P[0], [notInHand]);
      expect(error).toBe('Cards not in hand');
      expect(getState()).toEqual(s);
    });
  });

  describe('handlePlay — 轮次校验', () => {
    it('不是自己的出牌轮次时返回 error', async () => {
      const s = playingState({ currentTurnIndex: 0 });
      const { rm, getState } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const { error } = await sm.handlePlay('test-room', P[1], [
        { suit: Suit.Heart, rank: Rank.Four },
      ]);
      expect(error).toBe('Not your turn');
      expect(getState()).toEqual(s);
    });
  });

  describe('handleBid — 全员不叫地主', () => {
    it('三人全 pass 后重新发牌，phase 仍为 Bidding，biddingPassCount 归零', async () => {
      const { rm, getState } = makeRM(biddingState());
      const sm = new GameStateMachine(rm, makeTimeout());

      // player-0 pass → biddingPassCount=1, currentTurnIndex=1
      await sm.handleBid('test-room', P[0], false);
      // player-1 pass → biddingPassCount=2, currentTurnIndex=2
      await sm.handleBid('test-room', P[1], false);
      // player-2 pass → 重新发牌
      await sm.handleBid('test-room', P[2], false);

      const final = getState();
      expect(final.phase).toBe(GamePhase.Bidding);
      expect(final.biddingPassCount).toBe(0);
      expect(final.currentTurnIndex).toBe(0);
      // 重新发牌后每人 17 张
      expect(final.players[0].handCards).toHaveLength(17);
      expect(final.players[1].handCards).toHaveLength(17);
      expect(final.players[2].handCards).toHaveLength(17);
      expect(final.kitty).toHaveLength(3);
      // 总牌数 = 54
      const total =
        final.players[0].handCards.length +
        final.players[1].handCards.length +
        final.players[2].handCards.length +
        final.kitty.length;
      expect(total).toBe(54);
    });

    it('有人叫地主后 phase 变为 Playing，地主拿到底牌', async () => {
      const s = biddingState();
      const { rm, getState } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      await sm.handleBid('test-room', P[0], false);
      // player-1 叫地主
      const next = await sm.handleBid('test-room', P[1], true);

      expect(next.phase).toBe(GamePhase.Playing);
      expect(next.landlordIndex).toBe(1);
      expect(next.players[1].role).toBe(PlayerRole.Landlord);
      // 底牌并入地主手牌（初始 1 张 + 0 张底牌 = 1 张，因 biddingState 中 kitty=[]）
      expect(next.players[0].role).toBe(PlayerRole.Farmer);
      expect(next.players[2].role).toBe(PlayerRole.Farmer);
    });
  });

  describe('checkWinner — 出完手牌', () => {
    it('玩家出完最后一张牌后 checkWinner 返回正确 playerId', async () => {
      // player-0 只有一张牌，出完即获胜
      const s = playingState({
        players: [
          player(P[0], [{ suit: Suit.Spade, rank: Rank.Ace }], PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }, { suit: Suit.Club, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }, { suit: Suit.Club, rank: Rank.Five }]),
        ],
      });
      const { rm, getState } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const { state: next, error } = await sm.handlePlay('test-room', P[0], [
        { suit: Suit.Spade, rank: Rank.Ace },
      ]);
      expect(error).toBeUndefined();
      expect(next.phase).toBe(GamePhase.Ended);
      expect(next.winnerId).toBe(P[0]);
      expect(getState().phase).toBe(GamePhase.Ended);
    });
  });

  describe('gameOver 事件', () => {
    it('游戏结束时 emit gameOver，携带正确 finalMultiplier（含炸弹加倍）', async () => {
      // player-0 出一个炸弹（4张相同）清空手牌，multiplier 应 ×2
      const bomb: Card[] = [
        { suit: Suit.Spade, rank: Rank.Seven },
        { suit: Suit.Heart, rank: Rank.Seven },
        { suit: Suit.Diamond, rank: Rank.Seven },
        { suit: Suit.Club, rank: Rank.Seven },
      ];
      const s = playingState({
        multiplier: 1,
        players: [
          player(P[0], bomb, PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (payload: GameOverPayload) => received.push(payload));

      await sm.handlePlay('test-room', P[0], bomb);

      expect(received).toHaveLength(1);
      expect(received[0].winnerId).toBe(P[0]);
      expect(received[0].finalMultiplier).toBe(2); // 1 × 2（炸弹）
      expect(received[0].roomId).toBe('test-room');
    });

    it('无炸弹普通赢牌时 finalMultiplier = 1', async () => {
      const card: Card = { suit: Suit.Spade, rank: Rank.Ace };
      const s = playingState({
        multiplier: 1,
        players: [
          player(P[0], [card], PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (p: GameOverPayload) => received.push(p));

      await sm.handlePlay('test-room', P[0], [card]);
      expect(received[0].finalMultiplier).toBe(1);
    });

    it('春天：地主赢且农民未出牌，finalMultiplier ×2', async () => {
      // 地主一张牌，两名农民各持 17 张（从未出牌）
      const winCard: Card = { suit: Suit.Spade, rank: Rank.Ace };
      const farmer17 = hand17(Suit.Heart); // 17 张，与地主牌不重叠

      const s = playingState({
        landlordIndex: 0,
        multiplier: 1,
        players: [
          player(P[0], [winCard], PlayerRole.Landlord),
          player(P[1], farmer17),
          player(P[2], farmer17.map(c => ({ ...c, suit: Suit.Diamond }))), // 不同花色保持唯一
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (p: GameOverPayload) => received.push(p));

      await sm.handlePlay('test-room', P[0], [winCard]);

      expect(received[0].winnerId).toBe(P[0]);
      expect(received[0].finalMultiplier).toBe(2); // 1 × 2（春天）
    });

    it('春天不成立（农民出过牌），finalMultiplier 不额外翻倍', async () => {
      const winCard: Card = { suit: Suit.Spade, rank: Rank.Ace };
      const farmer1 = hand17(Suit.Heart);

      const s = playingState({
        landlordIndex: 0,
        multiplier: 1,
        players: [
          player(P[0], [winCard], PlayerRole.Landlord),
          player(P[1], farmer1.slice(0, 16)), // 出过 1 张，剩 16
          player(P[2], hand17(Suit.Diamond)),
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (p: GameOverPayload) => received.push(p));

      await sm.handlePlay('test-room', P[0], [winCard]);
      expect(received[0].finalMultiplier).toBe(1); // 无春天加成
    });

    it('反春天：农民赢且地主未出牌，finalMultiplier ×2', async () => {
      // player-1（农民）出完最后一张，地主还有 20 张
      const winCard: Card = { suit: Suit.Joker, rank: Rank.BigJoker };
      const landlord20 = hand20(Suit.Spade);

      const s: GameState = {
        ...BASE,
        phase: GamePhase.Playing,
        landlordIndex: 0,
        currentTurnIndex: 1,   // 农民 player-1 的回合
        lastPlay: null,
        lastPlayerId: null,
        multiplier: 1,
        players: [
          player(P[0], landlord20, PlayerRole.Landlord),
          player(P[1], [winCard]),
          player(P[2], [{ suit: Suit.Heart, rank: Rank.Three }]),
        ],
      };
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (p: GameOverPayload) => received.push(p));

      await sm.handlePlay('test-room', P[1], [winCard]);

      expect(received[0].winnerId).toBe(P[1]);
      expect(received[0].finalMultiplier).toBe(2); // 1 × 2（反春天）
    });

    it('反春天不成立（地主出过牌），finalMultiplier 不额外翻倍', async () => {
      const winCard: Card = { suit: Suit.Joker, rank: Rank.BigJoker };

      const s: GameState = {
        ...BASE,
        phase: GamePhase.Playing,
        landlordIndex: 0,
        currentTurnIndex: 1,
        lastPlay: null,
        lastPlayerId: null,
        multiplier: 1,
        players: [
          player(P[0], hand20(Suit.Spade).slice(0, 19), PlayerRole.Landlord), // 出过1张，剩19
          player(P[1], [winCard]),
          player(P[2], [{ suit: Suit.Heart, rank: Rank.Three }]),
        ],
      };
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (p: GameOverPayload) => received.push(p));

      await sm.handlePlay('test-room', P[1], [winCard]);
      expect(received[0].finalMultiplier).toBe(1); // 无反春天加成
    });

    it('炸弹 + 春天同时成立，最终倍率 = 初始 × 2（炸弹）× 2（春天）', async () => {
      const bomb: Card[] = [
        { suit: Suit.Spade, rank: Rank.Seven },
        { suit: Suit.Heart, rank: Rank.Seven },
        { suit: Suit.Diamond, rank: Rank.Seven },
        { suit: Suit.Club, rank: Rank.Seven },
      ];
      const s = playingState({
        landlordIndex: 0,
        multiplier: 1,
        players: [
          player(P[0], bomb, PlayerRole.Landlord),
          player(P[1], hand17(Suit.Heart)),
          player(P[2], hand17(Suit.Diamond)),
        ],
      });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      const received: GameOverPayload[] = [];
      sm.on('gameOver', (p: GameOverPayload) => received.push(p));

      await sm.handlePlay('test-room', P[0], bomb);
      expect(received[0].finalMultiplier).toBe(4); // 1 × 2（炸弹）× 2（春天）
    });
  });

  describe('handlePass', () => {
    it('两人连续 pass 后轮回到出牌者，lastPlay 重置为 null', async () => {
      const lastPlayCard: Card = { suit: Suit.Spade, rank: Rank.Ace };
      const s = playingState({
        currentTurnIndex: 1, // player-1 的回合（player-0 刚出过牌）
        lastPlay: { pattern: 'Single' as any, cards: [lastPlayCard], rank: Rank.Ace },
        lastPlayerId: P[0],
        players: [
          player(P[0], [lastPlayCard, { suit: Suit.Club, rank: Rank.Two }], PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
      });
      const { rm, getState } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      // player-1 pass
      await sm.handlePass('test-room', P[1]);
      expect(getState().currentTurnIndex).toBe(2);
      expect(getState().lastPlay).not.toBeNull(); // 还没归零

      // player-2 pass → 绕回 player-0（lastPlayerId），重置 lastPlay
      await sm.handlePass('test-room', P[2]);
      const final = getState();
      expect(final.currentTurnIndex).toBe(0);
      expect(final.lastPlay).toBeNull();
      expect(final.lastPlayerId).toBeNull();
    });

    it('lastPlay 为 null 时 pass 抛出错误', async () => {
      const s = playingState({ lastPlay: null });
      const { rm } = makeRM(s);
      const sm = new GameStateMachine(rm, makeTimeout());

      await expect(sm.handlePass('test-room', P[0])).rejects.toThrow();
    });
  });

  describe('startGame', () => {
    it('startGame 后 phase=Bidding，54 张牌全部分配', async () => {
      const initial: GameState = {
        ...BASE,
        phase: GamePhase.WaitingToStart,
        currentTurnIndex: 0,
        lastPlay: null,
        lastPlayerId: null,
        players: [
          player(P[0]),
          player(P[1]),
          player(P[2]),
        ],
      };
      const { rm, getState } = makeRM(initial);
      const sm = new GameStateMachine(rm, makeTimeout());

      await sm.startGame('test-room');

      const final = getState();
      expect(final.phase).toBe(GamePhase.Bidding);
      const total =
        final.players[0].handCards.length +
        final.players[1].handCards.length +
        final.players[2].handCards.length +
        final.kitty.length;
      expect(total).toBe(54);
      expect(final.players[0].handCards).toHaveLength(17);
      expect(final.kitty).toHaveLength(3);
    });
  });

  // ─── onPlayerTimeout ──────────────────────────────────────────────────────

  describe('onPlayerTimeout', () => {
    function makeBot(returnCards: Card[]): BotPlayer {
      return { selectPlay: jest.fn().mockReturnValue(returnCards) } as unknown as BotPlayer;
    }

    it('bot 选出牌时，调用 handlePlay 并 emit botAction(PLAY)', async () => {
      const twoCards: Card[] = [
        { suit: Suit.Spade, rank: Rank.Three },
        { suit: Suit.Club,  rank: Rank.Three },
      ];
      const s = playingState({
        players: [
          player(P[0], twoCards, PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Heart, rank: Rank.Four }]),
          player(P[2], [{ suit: Suit.Diamond, rank: Rank.Five }]),
        ],
        lastPlay: null,
        currentTurnIndex: 0,
      });
      const { rm, getState } = makeRM(s);
      const botCard: Card = { suit: Suit.Spade, rank: Rank.Three };
      const bot = makeBot([botCard]);
      const sm = new GameStateMachine(rm, makeTimeout(), bot);

      const events: BotActionPayload[] = [];
      sm.on('botAction', (p: BotActionPayload) => events.push(p));

      await sm.onPlayerTimeout('test-room', P[0]);

      // bot.selectPlay 应被调用，参数为 P[0] 的手牌 和 lastPlay=null
      expect(bot.selectPlay).toHaveBeenCalledWith(twoCards, null);

      // 出牌后 P[0] 手牌应少 1 张
      const updated = getState();
      expect(updated.players[0].handCards).toHaveLength(1);

      // botAction 事件被 emit
      expect(events).toHaveLength(1);
      expect(events[0].playerId).toBe(P[0]);
      expect(events[0].action).toBe('PLAY');
      expect(events[0].cards).toEqual([botCard]);
    });

    it('bot 返回空数组时，调用 handlePass 并 emit botAction(PASS)', async () => {
      const lastCard: Card = { suit: Suit.Spade, rank: Rank.King };
      const lastSinglePlay = { pattern: 'Single' as const, cards: [lastCard], rank: Rank.King } as import('@doudizhu/types').ParsedPlay;
      const s = playingState({
        players: [
          player(P[0], [{ suit: Suit.Heart, rank: Rank.Four }], PlayerRole.Landlord),
          player(P[1], [{ suit: Suit.Diamond, rank: Rank.Five }]),
          player(P[2], [lastCard]),
        ],
        // currentTurnIndex=0 是 P[0] 的回合（需要压过 K）
        currentTurnIndex: 0,
        lastPlay: lastSinglePlay,
        lastPlayerId: P[2],
      });
      const { rm } = makeRM(s);
      const bot = makeBot([]); // 返回空数组 → pass
      const sm = new GameStateMachine(rm, makeTimeout(), bot);

      const events: BotActionPayload[] = [];
      sm.on('botAction', (p: BotActionPayload) => events.push(p));

      await sm.onPlayerTimeout('test-room', P[0]);

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('PASS');
      expect(events[0].cards).toHaveLength(0);
    });

    it('超时玩家不是当前出牌方 → 直接返回，不操作', async () => {
      const s = playingState({ currentTurnIndex: 1 }); // P[1] 的回合
      const { rm } = makeRM(s);
      const bot = makeBot([]);
      const sm = new GameStateMachine(rm, makeTimeout(), bot);

      const events: BotActionPayload[] = [];
      sm.on('botAction', (p: BotActionPayload) => events.push(p));

      await sm.onPlayerTimeout('test-room', P[0]); // P[0] 超时，但不是 P[0] 的回合

      expect(bot.selectPlay).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });

    it('游戏已结束（winnerId 非 null）→ 直接返回，不操作', async () => {
      const s = playingState({ winnerId: P[0] });
      const { rm } = makeRM(s);
      const bot = makeBot([]);
      const sm = new GameStateMachine(rm, makeTimeout(), bot);

      const events: BotActionPayload[] = [];
      sm.on('botAction', (p: BotActionPayload) => events.push(p));

      await sm.onPlayerTimeout('test-room', P[0]);

      expect(bot.selectPlay).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });

    it('房间不存在 → 直接返回，不操作', async () => {
      const s = playingState();
      const { rm } = makeRM(s);
      // 让 getRoom 返回 null 模拟房间消失
      (rm.getRoom as jest.Mock).mockResolvedValue(null);
      const bot = makeBot([]);
      const sm = new GameStateMachine(rm, makeTimeout(), bot);

      await sm.onPlayerTimeout('test-room', P[0]);

      expect(bot.selectPlay).not.toHaveBeenCalled();
    });
  });
});
