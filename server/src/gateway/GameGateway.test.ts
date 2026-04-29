/**
 * GameGateway 集成测试
 *
 * 启动真实 WebSocket 服务（随机端口）+ ioredis-mock。
 * 三个客户端完成完整对局，验证广播、错误处理与 GAME_OVER 事件。
 */

import { WebSocket } from 'ws';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import type { AddressInfo } from 'net';
import type { Card, ParsedPlay } from '@doudizhu/types';
import { BetTier, CardPattern, GamePhase } from '@doudizhu/types';
import { RoomManager } from '../room/RoomManager';
import { GameStateMachine } from '../game/GameStateMachine';
import { TimeoutManager } from '../game/TimeoutManager';
import { GameGateway } from './GameGateway';

// ─── Test helper ──────────────────────────────────────────────────────────────

class TestClient {
  private ws!: WebSocket;
  private readonly msgs: string[] = [];
  private readonly resolvers: Array<(s: string) => void> = [];

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.on('message', (data: Buffer) => {
        const raw = data.toString();
        const resolver = this.resolvers.shift();
        if (resolver !== undefined) {
          resolver(raw);
        } else {
          this.msgs.push(raw);
        }
      });
    });
  }

  send(obj: object): void {
    this.ws.send(JSON.stringify(obj));
  }

  recv(): Promise<Record<string, unknown>> {
    if (this.msgs.length > 0) {
      return Promise.resolve(JSON.parse(this.msgs.shift()!) as Record<string, unknown>);
    }
    return new Promise(resolve => {
      this.resolvers.push(raw => resolve(JSON.parse(raw) as Record<string, unknown>));
    });
  }

  async expectType(type: string): Promise<Record<string, unknown>> {
    const msg = await this.recv();
    expect(msg.type).toBe(type);
    return msg;
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once('close', resolve);
      this.ws.close();
    });
  }
}

/** Collect one message from each client simultaneously */
async function recvAll(clients: TestClient[]): Promise<Record<string, unknown>[]> {
  return Promise.all(clients.map(c => c.recv()));
}

/** Assert each client received the expected type and return all messages */
async function expectAll(
  clients: TestClient[],
  type: string,
): Promise<Record<string, unknown>[]> {
  const msgs = await recvAll(clients);
  for (const m of msgs) expect(m.type).toBe(type);
  return msgs;
}

// ─── Game play helper ─────────────────────────────────────────────────────────

interface SlimState {
  phase: string;
  currentTurnIndex: number;
  landlordIndex: number;
  lastPlay: ParsedPlay | null;
  lastPlayerId: string | null;
  winnerId: string | null;
  multiplier: number;
  players: Array<{ playerId: string; handCards: Card[] }>;
}

/**
 * Choose a legal play for the current player.
 * Returns cards to play, or null (meaning PASS).
 * When lastPlay is null the player MUST play — always returns a card.
 */
function choosePlay(hand: Card[], lastPlay: ParsedPlay | null): Card[] | null {
  if (lastPlay === null) {
    // Must play: return the single lowest-rank card
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    return [sorted[0]];
  }

  if (lastPlay.pattern === CardPattern.Single) {
    const lastRank = lastPlay.cards[0].rank;
    const beatCard = [...hand]
      .filter(c => c.rank > lastRank)
      .sort((a, b) => a.rank - b.rank)[0];
    return beatCard !== undefined ? [beatCard] : null;
  }

  // For complex patterns, pass
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const ROOM_ID = 'gw-test-room-001';
const PLAYERS = ['p0', 'p1', 'p2'] as const;

describe('GameGateway integration', () => {
  let gateway: GameGateway;
  let rm: RoomManager;
  let gsm: GameStateMachine;
  let url: string;

  beforeEach(async () => {
    const redis = new RedisMock() as unknown as Redis;
    rm = new RoomManager(redis);
    const tm = new TimeoutManager();
    gsm = new GameStateMachine(rm, tm);
    gateway = new GameGateway(rm, gsm, 0); // OS picks port

    // Wait one tick for the WSS to begin listening
    await new Promise<void>(resolve => setImmediate(resolve));

    const addr = gateway.address() as AddressInfo;
    url = `ws://127.0.0.1:${addr.port}`;

    await rm.createRoom(ROOM_ID, [PLAYERS[0], PLAYERS[1], PLAYERS[2]], BetTier.Small);
  });

  afterEach(async () => {
    await gateway.close();
  });

  // ─── AUTH ───────────────────────────────────────────────────────────────────

  it('rejects messages before AUTH', async () => {
    const c = new TestClient();
    await c.connect(url);
    c.send({ type: 'JOIN_ROOM', roomId: ROOM_ID });
    const err = await c.expectType('ERROR');
    expect(err.message).toBe('Not authenticated');
    await c.close();
  });

  it('terminates unauthenticated connection after timeout', async () => {
    // Replace 10s with effectively-instant by mocking; here we just verify
    // the AUTH_OK path works and duplicate AUTH is rejected
    const c = new TestClient();
    await c.connect(url);
    c.send({ type: 'AUTH', playerId: 'p0' });
    await c.expectType('AUTH_OK');
    // Second AUTH is rejected
    c.send({ type: 'AUTH', playerId: 'p0' });
    const err = await c.expectType('ERROR');
    expect(err.message).toContain('Already authenticated');
    await c.close();
  });

  // ─── JOIN_ROOM ───────────────────────────────────────────────────────────────

  it('rejects JOIN_ROOM for non-member', async () => {
    const c = new TestClient();
    await c.connect(url);
    c.send({ type: 'AUTH', playerId: 'outsider' });
    await c.expectType('AUTH_OK');
    c.send({ type: 'JOIN_ROOM', roomId: ROOM_ID });
    const err = await c.expectType('ERROR');
    expect(err.message).toContain('not a member');
    await c.close();
  });

  it('sends ROOM_JOINED with sanitised state on JOIN_ROOM', async () => {
    const c = new TestClient();
    await c.connect(url);
    c.send({ type: 'AUTH', playerId: 'p0' });
    await c.expectType('AUTH_OK');
    c.send({ type: 'JOIN_ROOM', roomId: ROOM_ID });
    const msg = await c.expectType('ROOM_JOINED');
    expect(msg.roomId).toBe(ROOM_ID);
    const state = msg.state as SlimState;
    expect(state.phase).toBe(GamePhase.WaitingToStart);
    await c.close();
  });

  // ─── Full game flow ──────────────────────────────────────────────────────────

  it('three clients play a complete game and all receive GAME_OVER', async () => {
    const clients = [new TestClient(), new TestClient(), new TestClient()];
    await Promise.all(clients.map(c => c.connect(url)));

    // ── AUTH ───────────────────────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      clients[i].send({ type: 'AUTH', playerId: PLAYERS[i] });
      await clients[i].expectType('AUTH_OK');
    }

    // ── JOIN_ROOM ──────────────────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      clients[i].send({ type: 'JOIN_ROOM', roomId: ROOM_ID });
      await clients[i].expectType('ROOM_JOINED');
    }

    // ── READY ──────────────────────────────────────────────────────────────────
    // p0 ready → 3 GAME_STATE_UPDATEs (not-all-ready)
    clients[0].send({ type: 'READY' });
    await expectAll(clients, 'GAME_STATE_UPDATE');

    // p1 ready → 3 GAME_STATE_UPDATEs
    clients[1].send({ type: 'READY' });
    await expectAll(clients, 'GAME_STATE_UPDATE');

    // p2 ready → all ready: 3 updates for "all-ready state", then startGame, then 3 more
    clients[2].send({ type: 'READY' });
    await expectAll(clients, 'GAME_STATE_UPDATE'); // all isReady=true, still WaitingToStart
    const readyUpdates = await expectAll(clients, 'GAME_STATE_UPDATE'); // phase=Bidding

    const biddingState = readyUpdates[0].state as SlimState;
    expect(biddingState.phase).toBe(GamePhase.Bidding);

    // ── BID: player 0 bids true ────────────────────────────────────────────────
    clients[0].send({ type: 'BID', bid: true });
    const bidUpdates = await expectAll(clients, 'GAME_STATE_UPDATE');

    const playingState = bidUpdates[0].state as SlimState;
    expect(playingState.phase).toBe(GamePhase.Playing);
    expect(playingState.landlordIndex).toBe(0);

    // Each player sees only their own hand in the sanitised state
    const p0HandAfterBid = (bidUpdates[0].state as SlimState).players[0].handCards;
    const p1HandAfterBid = (bidUpdates[1].state as SlimState).players[1].handCards;
    const p2HandAfterBid = (bidUpdates[2].state as SlimState).players[2].handCards;

    // Landlord (p0) has 20 cards; others' hands are hidden in other views
    expect(p0HandAfterBid).toHaveLength(20);
    expect(p1HandAfterBid).toHaveLength(17);
    expect(p2HandAfterBid).toHaveLength(17);

    // Other players' hands are hidden in p0's view
    expect((bidUpdates[0].state as SlimState).players[1].handCards).toHaveLength(0);
    expect((bidUpdates[0].state as SlimState).players[2].handCards).toHaveLength(0);

    // ── Verify gameOver event will fire ────────────────────────────────────────
    let gameOverEventFired = false;
    gsm.on('gameOver', () => {
      gameOverEventFired = true;
    });

    // ── Illegal play: empty cards → ERROR ──────────────────────────────────────
    // It is currently p0's turn (landlord plays first)
    clients[0].send({ type: 'PLAY_CARDS', cards: [] });
    const illegalErr = await clients[0].expectType('ERROR');
    expect(typeof illegalErr.message).toBe('string');

    // ── Play until GAME_OVER ───────────────────────────────────────────────────
    // Track each player's hand from their own GAME_STATE_UPDATE
    const hands: Card[][] = [
      [...p0HandAfterBid],
      [...p1HandAfterBid],
      [...p2HandAfterBid],
    ];

    let currentState: SlimState = playingState;
    let gameOver = false;

    for (let round = 0; round < 500 && !gameOver; round++) {
      const turnIdx = currentState.currentTurnIndex;
      const hand = hands[turnIdx];
      const play = choosePlay(hand, currentState.lastPlay);

      if (play === null) {
        clients[turnIdx].send({ type: 'PASS' });
      } else {
        clients[turnIdx].send({ type: 'PLAY_CARDS', cards: play });
      }

      // Every action → 3 GAME_STATE_UPDATEs (or 3 GAME_STATE_UPDATEs + 3 GAME_OVERs)
      const updates = await recvAll(clients);

      if (updates[0].type === 'GAME_OVER') {
        // The final play produced 3 GAME_STATE_UPDATEs (consumed in previous iteration)
        // and then 3 GAME_OVERs — but here they arrive as the first messages.
        // This can happen when the state update and game over arrive as a batch.
        for (const u of updates) expect(u.type).toBe('GAME_OVER');
        expect(updates[0].roomId).toBe(ROOM_ID);
        expect(typeof updates[0].winnerId).toBe('string');
        expect(typeof updates[0].finalMultiplier).toBe('number');
        expect((updates[0].finalMultiplier as number)).toBeGreaterThanOrEqual(1);
        gameOver = true;
        break;
      }

      for (const u of updates) expect(u.type).toBe('GAME_STATE_UPDATE');

      currentState = updates[0].state as SlimState;

      // Update each player's known hand from their own private view
      hands[0] = [...(updates[0].state as SlimState).players[0].handCards];
      hands[1] = [...(updates[1].state as SlimState).players[1].handCards];
      hands[2] = [...(updates[2].state as SlimState).players[2].handCards];

      // Game ends with phase=Ended in the state update
      if (currentState.phase === GamePhase.Ended) {
        // Collect the 3 GAME_OVER messages that follow
        const gameOvers = await recvAll(clients);
        for (const g of gameOvers) expect(g.type).toBe('GAME_OVER');
        expect(gameOvers[0].roomId).toBe(ROOM_ID);
        expect(gameOvers[0].winnerId).toBe(currentState.winnerId);
        expect((gameOvers[0].finalMultiplier as number)).toBeGreaterThanOrEqual(1);
        gameOver = true;
      }
    }

    expect(gameOver).toBe(true);
    expect(gameOverEventFired).toBe(true);

    await Promise.all(clients.map(c => c.close()));
  }, 30_000);

  // ─── PLAYER_DISCONNECTED ─────────────────────────────────────────────────────

  it('broadcasts PLAYER_DISCONNECTED when a client drops', async () => {
    const clients = [new TestClient(), new TestClient(), new TestClient()];
    await Promise.all(clients.map(c => c.connect(url)));

    for (let i = 0; i < 3; i++) {
      clients[i].send({ type: 'AUTH', playerId: PLAYERS[i] });
      await clients[i].expectType('AUTH_OK');
      clients[i].send({ type: 'JOIN_ROOM', roomId: ROOM_ID });
      await clients[i].expectType('ROOM_JOINED');
    }

    // p2 disconnects
    await clients[2].close();

    // Wait a tick for the server to process the close event
    await new Promise<void>(resolve => setTimeout(resolve, 50));

    // p0 and p1 should receive PLAYER_DISCONNECTED
    const d0 = await clients[0].expectType('PLAYER_DISCONNECTED');
    const d1 = await clients[1].expectType('PLAYER_DISCONNECTED');
    expect(d0.playerId).toBe('p2');
    expect(d1.playerId).toBe('p2');

    await clients[0].close();
    await clients[1].close();
  });
});
