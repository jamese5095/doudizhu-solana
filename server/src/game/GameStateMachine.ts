import { EventEmitter } from 'events';
import { parsePlay, canBeat, isHandEmpty } from '@doudizhu/game-engine';
import {
  type GameState,
  type PlayerState,
  type Card,
  GamePhase,
  PlayerRole,
  CardPattern,
  Suit,
  Rank,
} from '@doudizhu/types';
import type { RoomManager } from '../room/RoomManager';
import type { TimeoutManager } from './TimeoutManager';
import { BotPlayer } from '../bot/BotPlayer';

export interface GameOverPayload {
  roomId: string;
  winnerId: string;
  finalMultiplier: number;
  /** 本局炸弹使用次数 */
  bombCount: number;
  /** 是否使用了火箭 */
  rocketUsed: boolean;
  /** 是否春天（地主赢且农民未出牌） */
  isSpring: boolean;
  /** 是否反春天（农民赢且地主未出牌） */
  isAntiSpring: boolean;
  /** 对局时长（秒） */
  gameDurationSecs: number;
}

export interface BotActionPayload {
  roomId: string;
  playerId: string;
  action: 'PLAY' | 'PASS';
  cards: Card[];
}

type Players3 = readonly [PlayerState, PlayerState, PlayerState];

function mapPlayers(
  players: Players3,
  fn: (p: PlayerState, i: number) => PlayerState,
): Players3 {
  return [fn(players[0], 0), fn(players[1], 1), fn(players[2], 2)] as Players3;
}

/** 每局经济追踪数据（非游戏状态，仅服务器内部使用） */
interface EconomyTracker {
  bombCount: number;
  rocketUsed: boolean;
  startTime: number; // Date.now() ms
}

export class GameStateMachine extends EventEmitter {
  /** 经济追踪：roomId → 本局炸弹/火箭/开始时间 */
  private readonly economyTrackers = new Map<string, EconomyTracker>();

  constructor(
    private readonly rm: RoomManager,
    private readonly timeout: TimeoutManager,
    private readonly bot: BotPlayer = new BotPlayer(),
  ) {
    super();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** 洗牌发牌，进入叫地主阶段，从 seat 0 开始叫 */
  async startGame(roomId: string): Promise<void> {
    const state = await this.requireRoom(roomId);
    const dealt = this.dealCards(state);
    await this.rm.updateRoom(roomId, dealt);
    this.startTurnTimer(roomId, dealt, dealt.currentTurnIndex);
  }

  /** 处理叫地主（bid=true 叫，false 不叫）。全不叫则重新发牌 */
  async handleBid(
    roomId: string,
    playerId: string,
    bid: boolean,
  ): Promise<GameState> {
    const state = await this.requireRoom(roomId);
    this.assertPhase(state, GamePhase.Bidding);
    this.assertTurn(state, playerId);

    let next: GameState;

    if (bid) {
      const idx = state.currentTurnIndex;
      const kittyCards = [...state.kitty];
      const landlordHand = [...state.players[idx].handCards, ...kittyCards];

      next = {
        ...state,
        phase: GamePhase.Playing,
        landlordIndex: idx,
        currentTurnIndex: idx,
        biddingPassCount: 0,
        players: mapPlayers(state.players, (p, i) =>
          i === idx
            ? { ...p, role: PlayerRole.Landlord, handCards: landlordHand }
            : { ...p, role: PlayerRole.Farmer },
        ),
      };

      // 初始化经济追踪器
      this.economyTrackers.set(roomId, {
        bombCount: 0,
        rocketUsed: false,
        startTime: Date.now(),
      });
    } else {
      const newCount = state.biddingPassCount + 1;
      if (newCount === 3) {
        // 全员不叫，重新发牌
        next = this.dealCards(state);
      } else {
        next = {
          ...state,
          biddingPassCount: newCount,
          currentTurnIndex: this.nextIdx(state.currentTurnIndex),
        };
      }
    }

    await this.rm.updateRoom(roomId, next);

    if (next.phase === GamePhase.Playing || next.phase === GamePhase.Bidding) {
      this.startTurnTimer(roomId, next, next.currentTurnIndex);
    }

    return next;
  }

  /** 处理出牌。返回 error 字段表示操作非法（状态不变）*/
  async handlePlay(
    roomId: string,
    playerId: string,
    cards: Card[],
  ): Promise<{ state: GameState; error?: string }> {
    const state = await this.requireRoom(roomId);

    if (state.phase !== GamePhase.Playing) {
      return { state, error: 'Game is not in playing phase' };
    }
    if (state.players[state.currentTurnIndex].playerId !== playerId) {
      return { state, error: 'Not your turn' };
    }

    const parsed = parsePlay(cards);
    if (parsed === null) {
      return { state, error: 'Invalid card combination' };
    }
    if (!canBeat(parsed, state.lastPlay)) {
      return { state, error: 'Cannot beat the last play' };
    }

    const currentIdx = state.currentTurnIndex;
    if (!this.hasCards(state.players[currentIdx].handCards, cards)) {
      return { state, error: 'Cards not in hand' };
    }

    const newHand = this.removeCards(state.players[currentIdx].handCards, cards);

    // 炸弹/火箭触发倍率 ×2 + 经济追踪
    const isBomb   = parsed.pattern === CardPattern.Bomb;
    const isRocket = parsed.pattern === CardPattern.Rocket;
    const newMultiplier = (isBomb || isRocket) ? state.multiplier * 2 : state.multiplier;

    if (isBomb || isRocket) {
      const tracker = this.economyTrackers.get(roomId);
      if (tracker) {
        if (isBomb) tracker.bombCount++;
        if (isRocket) tracker.rocketUsed = true;
      }
    }

    const nextTurnIdx = this.nextIdx(currentIdx);

    const newPlayers = mapPlayers(state.players, (p, i) =>
      i === currentIdx ? { ...p, handCards: newHand } : p,
    );

    let next: GameState = {
      ...state,
      players: newPlayers,
      lastPlay: parsed,
      lastPlayerId: playerId,
      currentTurnIndex: nextTurnIdx,
      multiplier: newMultiplier,
    };

    const winnerId = this.checkWinner(next);
    if (winnerId !== null) {
      // 检测春天/反春天，若成立再 ×2
      const isSpring     = this.checkSpring(next, winnerId);
      const isAntiSpring = !isSpring && this.checkAntiSpring(next, winnerId);
      const springMultiplier = (isSpring || isAntiSpring)
        ? next.multiplier * 2
        : next.multiplier;
      next = { ...next, phase: GamePhase.Ended, winnerId, multiplier: springMultiplier };
      this.timeout.clearTimer(roomId);
      await this.rm.updateRoom(roomId, next);

      const tracker = this.economyTrackers.get(roomId);
      const gameDurationSecs = tracker
        ? Math.floor((Date.now() - tracker.startTime) / 1000)
        : 0;

      const payload: GameOverPayload = {
        roomId,
        winnerId,
        finalMultiplier: springMultiplier,
        bombCount:       tracker?.bombCount ?? 0,
        rocketUsed:      tracker?.rocketUsed ?? false,
        isSpring,
        isAntiSpring,
        gameDurationSecs,
      };
      this.economyTrackers.delete(roomId);
      this.emit('gameOver', payload);
    } else {
      await this.rm.updateRoom(roomId, next);
      this.startTurnTimer(roomId, next, nextTurnIdx);
    }

    return { state: next };
  }

  /** 处理过牌。若连续过牌导致当前玩家重新成为出牌方，重置 lastPlay */
  async handlePass(roomId: string, playerId: string): Promise<GameState> {
    const state = await this.requireRoom(roomId);
    this.assertPhase(state, GamePhase.Playing);
    this.assertTurn(state, playerId);

    if (state.lastPlay === null) {
      throw new Error('Cannot pass when lastPlay is null — must play a card');
    }

    const nextTurnIdx = this.nextIdx(state.currentTurnIndex);

    // 若绕回到上次出牌者，本轮无人接上，重置 lastPlay
    const roundCompleted =
      state.players[nextTurnIdx].playerId === state.lastPlayerId;

    const next: GameState = {
      ...state,
      currentTurnIndex: nextTurnIdx,
      lastPlay: roundCompleted ? null : state.lastPlay,
      lastPlayerId: roundCompleted ? null : state.lastPlayerId,
    };

    await this.rm.updateRoom(roomId, next);
    this.startTurnTimer(roomId, next, nextTurnIdx);

    return next;
  }

  /** 单机模式：机器人叫地主决策 */
  async handleBotBid(roomId: string, playerId: string): Promise<GameState> {
    const state = await this.rm.getRoom(roomId);
    if (state === null || state.phase !== GamePhase.Bidding) return state!;
    if (state.players[state.currentTurnIndex].playerId !== playerId) return state;

    const hand = state.players[state.currentTurnIndex].handCards;
    const bid  = this.bot.shouldBid(hand);
    return this.handleBid(roomId, playerId, bid);
  }

  /** 超时回调：调用托管机器人代替玩家出牌或 pass */
  async onPlayerTimeout(roomId: string, playerId: string): Promise<void> {
    const state = await this.rm.getRoom(roomId);
    // 房间不存在或游戏已结束，忽略
    if (state === null || state.winnerId !== null) return;

    // 确认超时玩家确实是当前出牌方
    const currentPlayer = state.players[state.currentTurnIndex];
    if (currentPlayer.playerId !== playerId) return;

    const botCards = this.bot.selectPlay(currentPlayer.handCards, state.lastPlay);

    if (botCards.length > 0) {
      await this.handlePlay(roomId, playerId, botCards);
    } else {
      await this.handlePass(roomId, playerId);
    }

    const payload: BotActionPayload = {
      roomId,
      playerId,
      action: botCards.length > 0 ? 'PLAY' : 'PASS',
      cards: botCards,
    };
    this.emit('botAction', payload);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private checkWinner(state: GameState): string | null {
    for (const player of state.players) {
      if (isHandEmpty(player.handCards)) return player.playerId;
    }
    return null;
  }

  /**
   * 检测春天：地主赢，且两名农民均未出过一张牌（各剩 17 张）。
   *
   * 注意：此方法必须在 handCards 已去掉胜者最后一手牌之后调用，
   *       此时胜者手牌为空，其余玩家手牌数反映其实际历史出牌情况。
   */
  private checkSpring(state: GameState, winnerId: string): boolean {
    const landlord = state.players[state.landlordIndex];
    if (landlord.playerId !== winnerId) return false;
    return state.players.every(
      (p, i) => i === state.landlordIndex || p.handCards.length === 17,
    );
  }

  /**
   * 检测反春天：农民赢，且地主未出过一张牌（剩 20 张 = 初始 17 + 3 底牌）。
   */
  private checkAntiSpring(state: GameState, winnerId: string): boolean {
    const landlord = state.players[state.landlordIndex];
    if (landlord.playerId === winnerId) return false;
    return landlord.handCards.length === 20;
  }

  /** 洗牌发牌：17+17+17+3，重置至 Bidding phase */
  private dealCards(state: GameState): GameState {
    const deck = this.createShuffledDeck();
    const hands: [Card[], Card[], Card[]] = [
      deck.slice(0, 17),
      deck.slice(17, 34),
      deck.slice(34, 51),
    ];
    const kitty = deck.slice(51, 54);

    return {
      ...state,
      phase: GamePhase.Bidding,
      players: mapPlayers(state.players, (p, i) => ({
        ...p,
        handCards: hands[i],
        role: PlayerRole.Farmer,
        isReady: true,
      })),
      kitty,
      landlordIndex: 0,
      currentTurnIndex: 0,
      lastPlay: null,
      lastPlayerId: null,
      biddingPassCount: 0,
      multiplier: 1,
      winnerId: null,
    };
  }

  private createShuffledDeck(): Card[] {
    const normalRanks: Rank[] = [
      Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
      Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen,
      Rank.King, Rank.Ace, Rank.Two,
    ];
    const deck: Card[] = [];
    for (const suit of [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club]) {
      for (const rank of normalRanks) {
        deck.push({ suit, rank });
      }
    }
    deck.push({ suit: Suit.Joker, rank: Rank.SmallJoker });
    deck.push({ suit: Suit.Joker, rank: Rank.BigJoker });

    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  private nextIdx(idx: 0 | 1 | 2): 0 | 1 | 2 {
    return ((idx + 1) % 3) as 0 | 1 | 2;
  }

  private hasCards(hand: readonly Card[], played: readonly Card[]): boolean {
    const remaining = [...hand];
    for (const card of played) {
      const i = remaining.findIndex(
        c => c.suit === card.suit && c.rank === card.rank,
      );
      if (i === -1) return false;
      remaining.splice(i, 1);
    }
    return true;
  }

  private removeCards(hand: readonly Card[], played: readonly Card[]): Card[] {
    const remaining = [...hand];
    for (const card of played) {
      const i = remaining.findIndex(
        c => c.suit === card.suit && c.rank === card.rank,
      );
      if (i !== -1) remaining.splice(i, 1);
    }
    return remaining;
  }

  private startTurnTimer(
    roomId: string,
    state: GameState,
    idx: 0 | 1 | 2,
  ): void {
    const { playerId } = state.players[idx];
    this.timeout.startTimer(roomId, playerId, () => {
      void this.onPlayerTimeout(roomId, playerId);
    });
  }

  private assertPhase(state: GameState, phase: GamePhase): void {
    if (state.phase !== phase) {
      throw new Error(`Expected phase "${phase}", current is "${state.phase}"`);
    }
  }

  private assertTurn(state: GameState, playerId: string): void {
    if (state.players[state.currentTurnIndex].playerId !== playerId) {
      throw new Error(`Not ${playerId}'s turn`);
    }
  }

  private async requireRoom(roomId: string): Promise<GameState> {
    const state = await this.rm.getRoom(roomId);
    if (state === null) throw new Error(`Room "${roomId}" not found`);
    return state;
  }
}
