import RedisMock from 'ioredis-mock';
import { RoomManager } from './RoomManager';
import { BetTier, GamePhase, PlayerRole } from '@doudizhu/types';
import type Redis from 'ioredis';

function makeManager(): RoomManager {
  const redis = new RedisMock() as unknown as Redis;
  return new RoomManager(redis);
}

const PLAYERS: [string, string, string] = ['player-A', 'player-B', 'player-C'];
const ROOM_ID = 'room-001';

describe('RoomManager', () => {
  describe('createRoom → getRoom', () => {
    it('returns correct initial GameState', async () => {
      const rm = makeManager();
      const state = await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Small);

      expect(state.roomId).toBe(ROOM_ID);
      expect(state.betTier).toBe(BetTier.Small);
      expect(state.phase).toBe(GamePhase.WaitingToStart);
      expect(state.multiplier).toBe(1);
      expect(state.winnerId).toBeNull();
      expect(state.lastPlay).toBeNull();
      expect(state.kitty).toHaveLength(0);
      expect(state.players).toHaveLength(3);
      expect(state.players[0].playerId).toBe('player-A');
      expect(state.players[1].playerId).toBe('player-B');
      expect(state.players[2].playerId).toBe('player-C');
      state.players.forEach(p => {
        expect(p.role).toBe(PlayerRole.Farmer);
        expect(p.isReady).toBe(false);
        expect(p.handCards).toHaveLength(0);
      });
    });

    it('getRoom returns the same state that was stored', async () => {
      const rm = makeManager();
      const created = await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Medium);
      const fetched = await rm.getRoom(ROOM_ID);

      expect(fetched).toEqual(created);
    });

    it('player index is set after createRoom', async () => {
      const rm = makeManager();
      await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Small);

      expect(await rm.getPlayerRoom('player-A')).toBe(ROOM_ID);
      expect(await rm.getPlayerRoom('player-B')).toBe(ROOM_ID);
      expect(await rm.getPlayerRoom('player-C')).toBe(ROOM_ID);
    });
  });

  describe('player index overwrite', () => {
    it('when same player creates a second room the player index points to the new room', async () => {
      const rm = makeManager();
      await rm.createRoom('room-old', PLAYERS, BetTier.Small);
      await rm.createRoom('room-new', PLAYERS, BetTier.Small);

      expect(await rm.getPlayerRoom('player-A')).toBe('room-new');
      expect(await rm.getPlayerRoom('player-B')).toBe('room-new');
      expect(await rm.getPlayerRoom('player-C')).toBe('room-new');
    });
  });

  describe('getRoom with non-existent roomId', () => {
    it('returns null for unknown room', async () => {
      const rm = makeManager();
      const result = await rm.getRoom('no-such-room');
      expect(result).toBeNull();
    });
  });

  describe('deleteRoom', () => {
    it('getRoom returns null after deleteRoom', async () => {
      const rm = makeManager();
      await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Small);
      await rm.deleteRoom(ROOM_ID, [...PLAYERS]);

      expect(await rm.getRoom(ROOM_ID)).toBeNull();
    });

    it('player indexes are cleared after deleteRoom', async () => {
      const rm = makeManager();
      await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Small);
      await rm.deleteRoom(ROOM_ID, [...PLAYERS]);

      expect(await rm.getPlayerRoom('player-A')).toBeNull();
      expect(await rm.getPlayerRoom('player-B')).toBeNull();
      expect(await rm.getPlayerRoom('player-C')).toBeNull();
    });

    it('deleteRoom on non-existent room does not throw', async () => {
      const rm = makeManager();
      await expect(rm.deleteRoom('ghost-room', [...PLAYERS])).resolves.toBeUndefined();
    });

    it('player indexes are NOT cleared if wrong playerIds provided', async () => {
      const rm = makeManager();
      await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Small);
      await rm.deleteRoom(ROOM_ID, []);

      // room gone, but player indexes intact — caller's responsibility
      expect(await rm.getRoom(ROOM_ID)).toBeNull();
      expect(await rm.getPlayerRoom('player-A')).toBe(ROOM_ID);
    });
  });

  describe('updateRoom', () => {
    it('persists updated state', async () => {
      const rm = makeManager();
      const original = await rm.createRoom(ROOM_ID, PLAYERS, BetTier.Small);
      const updated = { ...original, phase: GamePhase.Bidding, multiplier: 2 };
      await rm.updateRoom(ROOM_ID, updated);

      const fetched = await rm.getRoom(ROOM_ID);
      expect(fetched?.phase).toBe(GamePhase.Bidding);
      expect(fetched?.multiplier).toBe(2);
    });
  });
});
