import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import type { Card } from '@doudizhu/types';
import { GamePhase } from '@doudizhu/types';
import type { RoomManager } from '../room/RoomManager';
import type { GameStateMachine } from '../game/GameStateMachine';
import type { GameOverPayload, BotActionPayload } from '../game/GameStateMachine';
import type { SettleResult } from '../settler/Settler';
import type { CancellationKeeper } from '../settler/CancellationKeeper';

// ─── Client → Server messages ────────────────────────────────────────────────

interface AuthMsg           { type: 'AUTH';             playerId: string }
interface CreateRoomMsg     { type: 'CREATE_ROOM';      roomId: string; players: [string, string, string]; betTier: number }
interface CreateSoloRoomMsg { type: 'CREATE_SOLO_ROOM' }
interface JoinRoomMsg       { type: 'JOIN_ROOM';        roomId: string }
interface ReadyMsg          { type: 'READY' }
interface BidMsg            { type: 'BID';              bid: boolean }
interface PlayCardsMsg      { type: 'PLAY_CARDS';       cards: Card[] }
interface PassMsg           { type: 'PASS' }

type ClientMsg = AuthMsg | CreateRoomMsg | CreateSoloRoomMsg | JoinRoomMsg | ReadyMsg | BidMsg | PlayCardsMsg | PassMsg;

// ─── Server → Client messages ─────────────────────────────────────────────────

export interface ServerMsg {
  type: string;
  [key: string]: unknown;
}

// ─── Connection state ─────────────────────────────────────────────────────────

interface ConnState {
  playerId: string | null;
  authTimer: NodeJS.Timeout | null;
}

export class GameGateway {
  private readonly wss: WebSocketServer;
  /** playerId → WebSocket */
  private readonly playerConnections = new Map<string, WebSocket>();
  /** Per-room serialization lock — prevents race conditions on concurrent messages */
  private readonly roomLocks = new Map<string, Promise<void>>();
  /** 单机房间 ID 集合 */
  private readonly soloRooms = new Set<string>();
  /** 单机房间的机器人玩家 ID */
  private readonly botPlayerIds = new Map<string, [string, string]>();
  /** 超时取消守护（可选，仅多人联网房间使用） */
  private keeper: CancellationKeeper | null = null;
  /** playerId → IP 地址 */
  private readonly playerIps = new Map<string, string>();
  /** WebSocket → IP（连接时记录，AUTH 后映射到 playerId） */
  private readonly wsIps = new WeakMap<WebSocket, string>();

  private withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.roomLocks.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    this.roomLocks.set(roomId, new Promise<void>(r => { release = r; }));
    return prev.then(() => fn()).finally(() => { release(); });
  }

  isSoloRoom(roomId: string): boolean { return this.soloRooms.has(roomId); }

  /** 获取玩家 IP 地址（反作弊用） */
  getPlayerIp(playerId: string): string | null {
    return this.playerIps.get(playerId) ?? null;
  }

  /** 注入超时取消守护（在 index.ts 启动时调用，避免循环依赖） */
  setKeeper(keeper: CancellationKeeper): void {
    this.keeper = keeper;
  }

  constructor(
    private readonly rm: RoomManager,
    private readonly gsm: GameStateMachine,
    serverOrPort: Server | number,
  ) {
    this.wss = new WebSocketServer(
      typeof serverOrPort === 'number'
        ? { port: serverOrPort }
        : { server: serverOrPort },
    );

    this.gsm.on('gameOver', (payload: GameOverPayload) => {
      void this.handleGameOver(payload);
    });

    this.gsm.on('botAction', (payload: BotActionPayload) => {
      void this.handleBotAction(payload);
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        ?? req.socket.remoteAddress ?? undefined;
      if (ip) this.wsIps.set(ws, ip);
      this.onConnection(ws);
    });
  }

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  private onConnection(ws: WebSocket): void {
    const conn: ConnState = { playerId: null, authTimer: null };

    // Require AUTH within 10 seconds
    conn.authTimer = setTimeout(() => {
      if (conn.playerId === null) {
        this.send(ws, { type: 'ERROR', message: 'Authentication timeout' });
        ws.terminate();
      }
    }, 10_000);

    ws.on('message', (data: Buffer) => {
      void this.onMessage(ws, conn, data);
    });

    ws.on('close', () => {
      this.onClose(conn);
    });

    ws.on('error', () => {
      this.onClose(conn);
    });
  }

  private onClose(conn: ConnState): void {
    if (conn.authTimer !== null) {
      clearTimeout(conn.authTimer);
      conn.authTimer = null;
    }
    if (conn.playerId !== null) {
      this.playerConnections.delete(conn.playerId);
      this.playerIps.delete(conn.playerId);
      void this.broadcastDisconnect(conn.playerId);
    }
  }

  // ─── Message dispatch ─────────────────────────────────────────────────────

  private async onMessage(ws: WebSocket, conn: ConnState, raw: Buffer): Promise<void> {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      this.send(ws, { type: 'ERROR', message: 'Invalid JSON' });
      return;
    }

    try {
      if (msg.type === 'AUTH') {
        await this.handleAuth(ws, conn, msg);
        return;
      }

      if (conn.playerId === null) {
        this.send(ws, { type: 'ERROR', message: 'Not authenticated' });
        return;
      }

      switch (msg.type) {
        case 'CREATE_ROOM':      await this.handleCreateRoom(ws, conn.playerId, msg); break;
        case 'CREATE_SOLO_ROOM': await this.handleCreateSoloRoom(ws, conn.playerId); break;
        case 'JOIN_ROOM':        await this.handleJoinRoom(ws, conn.playerId, msg);  break;
        case 'READY':       await this.handleReady(ws, conn.playerId);           break;
        case 'BID':         await this.handleBid(ws, conn.playerId, msg);        break;
        case 'PLAY_CARDS':  await this.handlePlayCards(ws, conn.playerId, msg);  break;
        case 'PASS':        await this.handlePass(ws, conn.playerId);            break;
        default:
          this.send(ws, { type: 'ERROR', message: `Unknown message type: ${(msg as { type: string }).type}` });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(ws, { type: 'ERROR', message });
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  private async handleAuth(ws: WebSocket, conn: ConnState, msg: AuthMsg): Promise<void> {
    if (conn.playerId !== null) {
      this.send(ws, { type: 'ERROR', message: 'Already authenticated' });
      return;
    }
    if (!msg.playerId || typeof msg.playerId !== 'string') {
      this.send(ws, { type: 'ERROR', message: 'Invalid playerId' });
      return;
    }

    if (conn.authTimer !== null) {
      clearTimeout(conn.authTimer);
      conn.authTimer = null;
    }

    conn.playerId = msg.playerId;
    this.playerConnections.set(msg.playerId, ws);
    const wsIp = this.wsIps.get(ws);
    if (wsIp) this.playerIps.set(msg.playerId, wsIp);
    this.send(ws, { type: 'AUTH_OK', playerId: msg.playerId });
  }

  /**
   * CREATE_ROOM — 链上建房确认后由创建者发送，在 Redis 中创建房间状态。
   * 幂等：房间已存在时直接返回成功，不覆盖。
   */
  private async handleCreateRoom(ws: WebSocket, playerId: string, msg: CreateRoomMsg): Promise<void> {
    const { roomId, players, betTier } = msg;

    if (players.length !== 3 || !players.every(p => typeof p === 'string' && p.length > 0)) {
      this.send(ws, { type: 'ERROR', message: 'CREATE_ROOM 需要恰好3个玩家地址' });
      return;
    }
    if (!players.includes(playerId)) {
      this.send(ws, { type: 'ERROR', message: '创建者必须是房间成员之一' });
      return;
    }

    const existing = await this.rm.getRoom(roomId);
    if (existing !== null) {
      // 房间已存在，幂等返回成功
      this.send(ws, { type: 'ROOM_CREATED', roomId });
      return;
    }

    const { BetTier, GamePhase, PlayerRole } = await import('@doudizhu/types');
    const tierMap: Record<number, import('@doudizhu/types').BetTier> = {
      0: BetTier.Small, 1: BetTier.Medium, 2: BetTier.Large, 3: BetTier.Whale,
    };
    const tier = tierMap[betTier] ?? BetTier.Small;

    await this.rm.createRoom(roomId, players, tier);
    // 链上房间创建后，启动超时守护：35s 后若未开局则自动 cancel_room 退款
    this.keeper?.scheduleCancel(roomId, players);
    this.send(ws, { type: 'ROOM_CREATED', roomId });
  }

  /** CREATE_SOLO_ROOM — 创建单机练习房间，两个机器人自动就位并预先标记为准备 */
  private async handleCreateSoloRoom(ws: WebSocket, playerId: string): Promise<void> {
    const { BetTier } = await import('@doudizhu/types');

    const roomIdBytes = Array.from(crypto.getRandomValues(new Uint8Array(16)));
    const roomId = Buffer.from(roomIdBytes).toString('hex');
    const botId1 = `bot-${roomId.slice(0, 8)}-1`;
    const botId2 = `bot-${roomId.slice(0, 8)}-2`;

    const state = await this.rm.createRoom(roomId, [playerId, botId1, botId2], BetTier.Small);

    // 机器人自动标记为已准备
    const [p0, p1, p2] = state.players;
    const preReadied = {
      ...state,
      players: [p0, { ...p1, isReady: true }, { ...p2, isReady: true }] as typeof state.players,
    };
    await this.rm.updateRoom(roomId, preReadied);

    this.soloRooms.add(roomId);
    this.botPlayerIds.set(roomId, [botId1, botId2]);

    this.send(ws, { type: 'SOLO_ROOM_CREATED', roomId });
  }

  private async handleJoinRoom(ws: WebSocket, playerId: string, msg: JoinRoomMsg): Promise<void> {
    const { roomId } = msg;
    const state = await this.rm.getRoom(roomId);
    if (state === null) {
      this.send(ws, { type: 'ERROR', message: `Room "${roomId}" not found` });
      return;
    }

    const isInRoom = state.players.some(p => p.playerId === playerId);
    if (!isInRoom) {
      this.send(ws, { type: 'ERROR', message: 'You are not a member of this room' });
      return;
    }

    // Send current state to the joining player (hide others' hands)
    const sanitized = this.sanitizeStateFor(state, playerId);
    this.send(ws, { type: 'ROOM_JOINED', roomId, state: sanitized });
  }

  private async handleReady(ws: WebSocket, playerId: string): Promise<void> {
    const roomId = await this.requirePlayerRoom(ws, playerId);
    if (roomId === null) return;

    await this.withRoomLock(roomId, async () => {
      const state = await this.rm.getRoom(roomId);
      if (state === null) {
        this.send(ws, { type: 'ERROR', message: 'Room not found' });
        return;
      }

      if (state.phase !== GamePhase.WaitingToStart) {
        // Already started — send current state so client can sync
        await this.broadcastState(roomId, state);
        return;
      }

      // Persist this player's ready status
      const updatedPlayers = state.players.map(p =>
        p.playerId === playerId ? { ...p, isReady: true } : p,
      ) as unknown as typeof state.players;

      const updatedState = { ...state, players: updatedPlayers };
      await this.rm.updateRoom(roomId, updatedState);

      // Broadcast updated state to all players in room
      await this.broadcastState(roomId, updatedState);

      // If all players are ready, start the game
      if (updatedPlayers.every(p => p.isReady)) {
        // 全员就绪，取消超时守护（游戏即将正常开始）
        this.keeper?.clearSchedule(roomId);
        await this.gsm.startGame(roomId);
        const gameState = await this.rm.getRoom(roomId);
        if (gameState !== null) {
          await this.broadcastState(roomId, gameState);
        }
      }
    });
  }

  private async handleBid(ws: WebSocket, playerId: string, msg: BidMsg): Promise<void> {
    const roomId = await this.requirePlayerRoom(ws, playerId);
    if (roomId === null) return;

    const next = await this.gsm.handleBid(roomId, playerId, msg.bid);
    await this.broadcastState(roomId, next);
  }

  private async handlePlayCards(ws: WebSocket, playerId: string, msg: PlayCardsMsg): Promise<void> {
    const roomId = await this.requirePlayerRoom(ws, playerId);
    if (roomId === null) return;

    const { state, error } = await this.gsm.handlePlay(roomId, playerId, msg.cards);
    if (error !== undefined) {
      this.send(ws, { type: 'ERROR', message: error });
      return;
    }
    await this.broadcastState(roomId, state);
  }

  private async handlePass(ws: WebSocket, playerId: string): Promise<void> {
    const roomId = await this.requirePlayerRoom(ws, playerId);
    if (roomId === null) return;

    const next = await this.gsm.handlePass(roomId, playerId);
    await this.broadcastState(roomId, next);
  }

  // ─── gameOver event ───────────────────────────────────────────────────────

  private async handleGameOver(payload: GameOverPayload): Promise<void> {
    const { roomId, winnerId, finalMultiplier } = payload;
    const state = await this.rm.getRoom(roomId);
    if (state === null) return;

    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        this.send(ws, {
          type: 'GAME_OVER',
          roomId,
          winnerId,
          finalMultiplier,
        });
      }
    }
  }

  // ─── botAction event ─────────────────────────────────────────────────────

  private async handleBotAction(payload: BotActionPayload): Promise<void> {
    const state = await this.rm.getRoom(payload.roomId);
    if (state === null) return;

    // 广播 BOT_ACTION 给所有真实玩家
    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        this.send(ws, {
          type: 'BOT_ACTION',
          playerId: payload.playerId,
          action: payload.action,
          cards: payload.cards,
        });
      }
    }

    // 广播最新游戏状态（修复：bot 行动后客户端需要更新状态）
    await this.broadcastState(payload.roomId, state);
  }

  // ─── 单机模式 bot 行动调度 ────────────────────────────────────────────────

  /** 单机模式虚拟结算（不上链，直接发送结算结果） */
  async broadcastSoloSettlement(payload: GameOverPayload): Promise<void> {
    const state = await this.rm.getRoom(payload.roomId);
    if (!state) return;

    const BASE = 100n;
    const mul  = BigInt(payload.finalMultiplier);
    const landlord = state.players[state.landlordIndex];
    const landWon  = landlord.playerId === payload.winnerId;

    const payouts = state.players.map(p => {
      const isLandlord = p.playerId === landlord.playerId;
      const delta = landWon
        ? (isLandlord ? BASE * mul * 2n : -(BASE * mul))
        : (isLandlord ? -(BASE * mul * 2n) : BASE * mul);
      return { playerId: p.playerId, delta: delta.toString() };
    });

    const wire = {
      type:           'SETTLEMENT_CONFIRMED',
      roomId:         payload.roomId,
      txSignature:    'solo-mode',
      winnerId:       payload.winnerId,
      finalMultiplier: payload.finalMultiplier,
      payouts,
      fee:            '0',
      verified:       false,
      settledAt:      Math.floor(Date.now() / 1000),
      isSolo:         true,
    };

    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws?.readyState === WebSocket.OPEN) this.send(ws, wire);
    }

    // 清理
    this.soloRooms.delete(payload.roomId);
    this.botPlayerIds.delete(payload.roomId);
    await this.rm.deleteRoom(payload.roomId, state.players.map(p => p.playerId));
  }

  /** 若当前轮到机器人（单机模式），延迟后自动行动 */
  private scheduleSoloBotTurn(
    roomId: string,
    state: import('@doudizhu/types').GameState,
  ): void {
    const { GamePhase } = require('@doudizhu/types') as typeof import('@doudizhu/types');
    if (state.phase === GamePhase.Ended || state.winnerId !== null) return;

    const bots = this.botPlayerIds.get(roomId);
    if (!bots) return;

    const currentId = state.players[state.currentTurnIndex].playerId;
    if (!bots.includes(currentId)) return;

    const delay = state.phase === GamePhase.Bidding ? 800 : 1500;

    setTimeout(() => {
      void (async () => {
        try {
          if (state.phase === GamePhase.Bidding) {
            const next = await this.gsm.handleBotBid(roomId, currentId);
            await this.broadcastState(roomId, next);
          } else if (state.phase === GamePhase.Playing) {
            // onPlayerTimeout 内部调 handlePlay/handlePass，并 emit botAction
            // botAction 监听器会广播 BOT_ACTION + GAME_STATE_UPDATE
            await this.gsm.onPlayerTimeout(roomId, currentId);
          }
        } catch (e) {
          console.error('[Solo] Bot 行动失败:', e);
        }
      })();
    }, delay);
  }

  // ─── Broadcast helpers ────────────────────────────────────────────────────

  private async broadcastState(roomId: string, state: import('@doudizhu/types').GameState): Promise<void> {
    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws === undefined || ws.readyState !== WebSocket.OPEN) continue;

      const sanitized = this.sanitizeStateFor(state, player.playerId);
      this.send(ws, { type: 'GAME_STATE_UPDATE', state: sanitized });
    }

    // 单机模式：若当前轮到机器人，自动调度 bot 行动
    if (this.soloRooms.has(roomId)) {
      this.scheduleSoloBotTurn(roomId, state);
    }
  }

  private async broadcastDisconnect(playerId: string): Promise<void> {
    const roomId = await this.rm.getPlayerRoom(playerId);
    if (roomId === null) return;

    const state = await this.rm.getRoom(roomId);
    if (state === null) return;

    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        this.send(ws, { type: 'PLAYER_DISCONNECTED', playerId });
      }
    }
  }

  /**
   * 对外发送前，隐藏其他玩家的手牌（保留本人手牌）。
   */
  private sanitizeStateFor(
    state: import('@doudizhu/types').GameState,
    viewerId: string,
  ): object {
    // 对手手牌用等长占位数组代替真实内容，保留张数信息供客户端显示
    const placeholder = { suit: 0, rank: 0 };
    return {
      ...state,
      kitty: state.phase === GamePhase.Playing || state.phase === GamePhase.Ended
        ? state.kitty
        : [],
      players: state.players.map(p => ({
        ...p,
        handCards: p.playerId === viewerId
          ? p.handCards
          : Array(p.handCards.length).fill(placeholder),
      })),
    };
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private async requirePlayerRoom(ws: WebSocket, playerId: string): Promise<string | null> {
    const roomId = await this.rm.getPlayerRoom(playerId);
    if (roomId === null) {
      this.send(ws, { type: 'ERROR', message: 'You are not in any room' });
      return null;
    }
    // Secondary verification per CLAUDE.md
    const state = await this.rm.getRoom(roomId);
    if (state === null) {
      this.send(ws, { type: 'ERROR', message: 'Room no longer exists' });
      return null;
    }
    return roomId;
  }

  /** 等待 WS 服务器监听就绪（测试用） */
  address(): ReturnType<WebSocketServer['address']> {
    return this.wss.address();
  }

  // ─── Settlement broadcast (called from index.ts after settler.settle) ───────

  broadcastSettlement(result: SettleResult): void {
    void this.broadcastSettlementInternal(result);
  }

  private async broadcastSettlementInternal(result: SettleResult): Promise<void> {
    const state = await this.rm.getRoom(result.roomId);
    if (state === null) return;

    // bigint 不能被 JSON.stringify —— 统一序列化为 string，前端用 BigInt(v) 解析
    const wire = {
      type:            'SETTLEMENT_CONFIRMED',
      roomId:          result.roomId,
      txSignature:     result.txSignature,
      winnerId:        result.winnerId,
      finalMultiplier: result.finalMultiplier,
      payouts:         result.payouts.map(p => ({ playerId: p.playerId, delta: p.delta.toString() })),
      fee:             result.fee.toString(),
      verified:        result.verified,
      settledAt:       result.settledAt,
    };

    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        this.send(ws, wire);
      }
    }
  }

  broadcastSettlementError(roomId: string): void {
    void this.broadcastSettlementErrorInternal(roomId);
  }

  private async broadcastSettlementErrorInternal(roomId: string): Promise<void> {
    const state = await this.rm.getRoom(roomId);
    if (state === null) return;

    for (const player of state.players) {
      const ws = this.playerConnections.get(player.playerId);
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        this.send(ws, {
          type:    'SETTLEMENT_FAILED',
          roomId,
          message: '结算异常，请联系客服，您的资金安全',
        });
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close(err => (err ? reject(err) : resolve()));
    });
  }
}
