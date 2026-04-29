import type Redis from 'ioredis';
import {
  type GameState,
  type BetTier,
  GamePhase,
  PlayerRole,
} from '@doudizhu/types';

const ROOM_TTL = 3600; // seconds

function roomKey(roomId: string): string {
  return `room:${roomId}`;
}

function playerKey(playerId: string): string {
  return `player:${playerId}`;
}

export class RoomManager {
  constructor(private readonly redis: Redis) {}

  async createRoom(
    roomId: string,
    players: [string, string, string],
    betTier: BetTier,
  ): Promise<GameState> {
    const state: GameState = {
      roomId,
      phase: GamePhase.WaitingToStart,
      players: [
        { playerId: players[0], role: PlayerRole.Farmer, handCards: [], isReady: false },
        { playerId: players[1], role: PlayerRole.Farmer, handCards: [], isReady: false },
        { playerId: players[2], role: PlayerRole.Farmer, handCards: [], isReady: false },
      ],
      landlordIndex: 0,
      currentTurnIndex: 0,
      lastPlay: null,
      lastPlayerId: null,
      kitty: [],
      multiplier: 1,
      winnerId: null,
      betTier,
      biddingPassCount: 0,
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(roomKey(roomId), JSON.stringify(state), 'EX', ROOM_TTL);
    for (const playerId of players) {
      pipeline.set(playerKey(playerId), roomId, 'EX', ROOM_TTL);
    }
    await pipeline.exec();

    return state;
  }

  async getRoom(roomId: string): Promise<GameState | null> {
    const raw = await this.redis.get(roomKey(roomId));
    if (raw === null) return null;
    return JSON.parse(raw) as GameState;
  }

  async updateRoom(roomId: string, state: GameState): Promise<void> {
    await this.redis.set(roomKey(roomId), JSON.stringify(state), 'EX', ROOM_TTL);
  }

  async deleteRoom(roomId: string, playerIds: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(roomKey(roomId));
    for (const playerId of playerIds) {
      pipeline.del(playerKey(playerId));
    }
    await pipeline.exec();
  }

  async getPlayerRoom(playerId: string): Promise<string | null> {
    return this.redis.get(playerKey(playerId));
  }
}
