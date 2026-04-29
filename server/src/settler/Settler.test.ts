/**
 * Settler 单元测试 — mock 所有链上调用
 *
 * 测试 settler 逻辑而不触碰真实 Devnet。
 */

import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { BetTier, GamePhase, PlayerRole } from '@doudizhu/types';
import type { GameState } from '@doudizhu/types';
import { RoomManager } from '../room/RoomManager';
import { Settler, AlreadySettledError } from './Settler';
import type { GameOverPayload } from '../game/GameStateMachine';

/** 构造测试用 GameOverPayload，自动填充经济模型默认字段 */
function makePayload(partial: { roomId: string; winnerId: string; finalMultiplier: number }): GameOverPayload {
  return {
    ...partial,
    bombCount: 0,
    rocketUsed: false,
    isSpring: false,
    isAntiSpring: false,
    gameDurationSecs: 180,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf');
const MINT       = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');

// Deterministic test keypairs (生成一次，固定复用)
const relayer  = Keypair.generate();
const player0  = Keypair.generate();
const player1  = Keypair.generate();
const player2  = Keypair.generate();
const treasury = Keypair.generate();

const ROOM_ID    = 'deadbeefcafebabedeadbeefcafebabe'; // 32-hex = 16 bytes
const BASE_SCORE = 1000n;

// 创建可被 Settler 接受的 mock Transaction
function mockTx(): Transaction {
  const tx = {
    recentBlockhash: undefined as string | undefined,
    lastValidBlockHeight: undefined as number | undefined,
    feePayer: undefined as PublicKey | undefined,
    sign: jest.fn(),
    serialize: jest.fn(() => Buffer.from('mock-raw-tx')),
  } as unknown as Transaction;
  return tx;
}

// 构建 mock Anchor Program
function makeProgram(overrides: {
  isSettled?: boolean;
  sendRawTx?: jest.Mock;
  confirmTx?: jest.Mock;
  getBalance?: jest.Mock;
  transactionFn?: jest.Mock;
} = {}) {
  const {
    isSettled     = false,
    sendRawTx     = jest.fn().mockResolvedValue('mock-tx-sig'),
    confirmTx     = jest.fn().mockResolvedValue({ value: { err: null } }),
    getBalance    = jest.fn().mockResolvedValue({ value: { amount: '5000' } }),
    transactionFn = jest.fn().mockResolvedValue(mockTx()),
  } = overrides;

  const settleAccountsMock = jest.fn().mockReturnValue({ transaction: transactionFn });
  const settleMethodMock   = jest.fn().mockReturnValue({ accounts: settleAccountsMock });

  const program = {
    programId: PROGRAM_ID,
    account: {
      escrowAccount: {
        fetch: jest.fn().mockResolvedValue({
          isSettled,
          deposits: [{ toString: () => '1000' }, { toString: () => '1000' }, { toString: () => '1000' }],
        }),
      },
      roomAccount: {
        fetch: jest.fn().mockResolvedValue({
          baseScore: { toString: () => BASE_SCORE.toString() },
          landlordIndex: 0,
          players: [player0.publicKey, player1.publicKey, player2.publicKey],
        }),
      },
    },
    methods: {
      settle: settleMethodMock,
    },
    provider: {
      connection: {
        getLatestBlockhash: jest.fn().mockResolvedValue({
          blockhash:           'mock-blockhash',
          lastValidBlockHeight: 999,
        }),
        sendRawTransaction:  sendRawTx,
        confirmTransaction:  confirmTx,
        getTokenAccountBalance: getBalance,
      },
    },
  };

  return { program, settleMethodMock, settleAccountsMock, transactionFn, sendRawTx, confirmTx, getBalance };
}

// 构建 Playing 状态 GameState
function playingState(
  landlordIndex: 0 | 1 | 2 = 0,
  overrides: Partial<GameState> = {},
): GameState {
  return {
    roomId:           ROOM_ID,
    phase:            GamePhase.Ended,
    landlordIndex,
    currentTurnIndex: landlordIndex,
    lastPlay:         null,
    lastPlayerId:     null,
    kitty:            [],
    multiplier:       1,
    winnerId:         player0.publicKey.toBase58(),
    betTier:          BetTier.Small,
    biddingPassCount: 0,
    players: [
      { playerId: player0.publicKey.toBase58(), role: PlayerRole.Landlord, handCards: [], isReady: true },
      { playerId: player1.publicKey.toBase58(), role: PlayerRole.Farmer,   handCards: [], isReady: true },
      { playerId: player2.publicKey.toBase58(), role: PlayerRole.Farmer,   handCards: [], isReady: true },
    ],
    ...overrides,
  };
}

// RoomManager backed by in-memory redis-mock
function makeRM(state: GameState): RoomManager {
  const redis = new RedisMock() as unknown as Redis;
  const rm = new RoomManager(redis);
  // 直接向 Redis 写入状态，绕过 createRoom 的初始化逻辑
  void redis.set(`room:${ROOM_ID}`, JSON.stringify(state), 'EX', 3600);
  void redis.set(`player:${player0.publicKey.toBase58()}`, ROOM_ID, 'EX', 3600);
  void redis.set(`player:${player1.publicKey.toBase58()}`, ROOM_ID, 'EX', 3600);
  void redis.set(`player:${player2.publicKey.toBase58()}`, ROOM_ID, 'EX', 3600);
  return rm;
}

function makeSettler(program: ReturnType<typeof makeProgram>['program'], state: GameState) {
  const rm = makeRM(state);
  return new Settler(
    rm,
    program as never, // typed as never to satisfy TS without importing full Program type
    relayer,
    MINT,
    treasury.publicKey,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Settler', () => {
  // ── 1. 正常流程 ──────────────────────────────────────────────────────────

  it('正常结算：program.methods.settle 被调用，返回 SettleResult', async () => {
    const { program, settleMethodMock } = makeProgram();
    const state = playingState(0);
    const settler = makeSettler(program, state);

    const result = await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player0.publicKey.toBase58(),
      finalMultiplier: 2,
    }));

    expect(result.txSignature).toBe('mock-tx-sig');
    expect(result.roomId).toBe(ROOM_ID);
    expect(result.winnerId).toBe(player0.publicKey.toBase58());
    expect(result.finalMultiplier).toBe(2);
    expect(result.fee).toBeGreaterThan(0n);
    expect(result.settledAt).toBeGreaterThan(0);
    expect(Array.isArray(result.payouts)).toBe(true);
    expect(result.payouts).toHaveLength(3);
    expect(settleMethodMock).toHaveBeenCalledTimes(1);
  });

  // ── 2. winnerIndex 计算正确 ──────────────────────────────────────────────

  it('winnerId=player1 时 winnerIndex=1 传入合约', async () => {
    const { program, settleMethodMock } = makeProgram();
    const state = playingState(
      0,
      {
        winnerId: player1.publicKey.toBase58(),
        players: [
          { playerId: player0.publicKey.toBase58(), role: PlayerRole.Landlord, handCards: [], isReady: true },
          { playerId: player1.publicKey.toBase58(), role: PlayerRole.Farmer,   handCards: [], isReady: true },
          { playerId: player2.publicKey.toBase58(), role: PlayerRole.Farmer,   handCards: [], isReady: true },
        ],
      },
    );
    const settler = makeSettler(program, state);

    await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player1.publicKey.toBase58(),
      finalMultiplier: 1,
    }));

    // settle(roomIdBytes, winnerIndex, landlordIndex, finalMultiplier)
    expect(settleMethodMock).toHaveBeenCalledWith(
      expect.any(Array), // roomIdBytes
      1,                 // winnerIndex = 1 (player1)
      0,                 // landlordIndex from state
      1,                 // finalMultiplier
    );
  });

  // ── 3. finalMultiplier 原样传入合约 ─────────────────────────────────────

  it('finalMultiplier=4 原样传入合约，不被修改', async () => {
    const { program, settleMethodMock } = makeProgram();
    const state = playingState(0);
    const settler = makeSettler(program, state);

    await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player0.publicKey.toBase58(),
      finalMultiplier: 4,
    }));

    expect(settleMethodMock).toHaveBeenCalledWith(
      expect.any(Array),
      0,  // winnerIndex
      0,  // landlordIndex
      4,  // finalMultiplier 未变
    );
  });

  // ── 4. 重试：第一次失败，第二次成功 ─────────────────────────────────────

  it('sendRawTransaction 第一次失败，第二次成功 → 返回成功结果', async () => {
    const sendRawTx = jest.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('retry-tx-sig');

    const { program } = makeProgram({ sendRawTx });
    const state = playingState(0);
    const settler = makeSettler(program, state);

    const result = await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player0.publicKey.toBase58(),
      finalMultiplier: 2,
    }));

    expect(result.txSignature).toBe('retry-tx-sig');
    expect(sendRawTx).toHaveBeenCalledTimes(2);
  }, 10_000); // 重试有 1s 延迟

  // ── 5. AlreadySettled 立即停止重试 ──────────────────────────────────────

  it('sendRawTransaction 抛 AlreadySettled → 立即 throw AlreadySettledError', async () => {
    const sendRawTx = jest.fn()
      .mockRejectedValue(new Error('Error: AlreadySettled (0x1776)'));

    const { program } = makeProgram({ sendRawTx });
    const state = playingState(0);
    const settler = makeSettler(program, state);

    await expect(
      settler.settle(makePayload({
        roomId:          ROOM_ID,
        winnerId:        player0.publicKey.toBase58(),
        finalMultiplier: 2,
      })),
    ).rejects.toBeInstanceOf(AlreadySettledError);

    // 应该只尝试了一次，立即停止
    expect(sendRawTx).toHaveBeenCalledTimes(1);
  });

  // ── 6. 网络超时：重新获取 blockhash 后重试 ──────────────────────────────

  it('网络超时后，每次重试都调用 getLatestBlockhash（获取新 blockhash）', async () => {
    const sendRawTx = jest.fn()
      .mockRejectedValueOnce(new Error('TransactionExpiredBlockheightExceededError'))
      .mockResolvedValueOnce('new-blockhash-tx-sig');

    const { program } = makeProgram({ sendRawTx });
    const state = playingState(0);
    const settler = makeSettler(program, state);

    const result = await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player0.publicKey.toBase58(),
      finalMultiplier: 1,
    }));

    expect(result.txSignature).toBe('new-blockhash-tx-sig');
    // getLatestBlockhash: 至少 2 次（每次 send 前 + 1 次 confirmTransaction 后）
    const getBlockhash = program.provider.connection.getLatestBlockhash as jest.Mock;
    expect(getBlockhash.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 10_000);

  // ── 7. 三次全部失败 → throw ──────────────────────────────────────────────

  it('sendRawTransaction 三次全部失败 → 最终 throw', async () => {
    const sendRawTx = jest.fn().mockRejectedValue(new Error('Persistent failure'));

    const { program } = makeProgram({ sendRawTx });
    const state = playingState(0);
    const settler = makeSettler(program, state);

    await expect(
      settler.settle(makePayload({
        roomId:          ROOM_ID,
        winnerId:        player0.publicKey.toBase58(),
        finalMultiplier: 2,
      })),
    ).rejects.toThrow('Persistent failure');

    expect(sendRawTx).toHaveBeenCalledTimes(3);
  }, 15_000);

  // ── 8. verifySettlement delta 计算：地主胜，误差在容忍范围内 ───────────

  it('地主胜时 payout delta 计算正确（base_score=1000, mult=2）', async () => {
    // base=1000, mult=2 → unit=2000
    // farmer deduction = min(2000, 1000) = 1000 each, total=2000
    // fee = 2000 * 2% = 40
    // landlord delta = 2000 - 40 = +1960
    // farmer delta   = -1000
    const { program } = makeProgram();
    const state = playingState(0);
    const settler = makeSettler(program, state);

    const result = await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player0.publicKey.toBase58(),
      finalMultiplier: 2,
    }));

    const p0 = result.payouts.find(p => p.playerId === player0.publicKey.toBase58())!;
    const p1 = result.payouts.find(p => p.playerId === player1.publicKey.toBase58())!;
    const p2 = result.payouts.find(p => p.playerId === player2.publicKey.toBase58())!;

    expect(p0.delta).toBe(1960n);  // landlord bonus
    expect(p1.delta).toBe(-1000n); // farmer loss
    expect(p2.delta).toBe(-1000n); // farmer loss
    expect(result.fee).toBe(40n);
  });

  it('农民胜时 payout delta 计算正确（base_score=1000, mult=1）', async () => {
    // farmer wins: landlord deduction = min(unit*2, base) = min(2000, 1000) = 1000
    // fee = 1000 * 2% = 20
    // farmer bonus = 1000 - 20 = 980, each farmer gets 490
    const { program } = makeProgram();
    const state = playingState(
      0,
      { winnerId: player1.publicKey.toBase58() }, // farmer wins
    );
    const settler = makeSettler(program, state);

    const result = await settler.settle(makePayload({
      roomId:          ROOM_ID,
      winnerId:        player1.publicKey.toBase58(),
      finalMultiplier: 1,
    }));

    const p0 = result.payouts.find(p => p.playerId === player0.publicKey.toBase58())!;
    const p1 = result.payouts.find(p => p.playerId === player1.publicKey.toBase58())!;
    const p2 = result.payouts.find(p => p.playerId === player2.publicKey.toBase58())!;

    expect(p0.delta).toBe(-1000n); // landlord loss
    // farmers split 980: 490 + 490 = 980 (980/2=490, rem=0)
    expect(p1.delta + p2.delta).toBe(980n);
    expect(result.fee).toBe(20n);
  });

  // ── 错误处理：finalMultiplier < 1 ────────────────────────────────────────

  it('finalMultiplier < 1 → 立即 throw', async () => {
    const { program } = makeProgram();
    const state = playingState(0);
    const settler = makeSettler(program, state);

    await expect(
      settler.settle(makePayload({
        roomId:          ROOM_ID,
        winnerId:        player0.publicKey.toBase58(),
        finalMultiplier: 0,
      })),
    ).rejects.toThrow('finalMultiplier must be >= 1');
  });

  // ── 错误处理：winnerId 不在房间内 ────────────────────────────────────────

  it('winnerId 不在房间玩家中 → throw', async () => {
    const { program } = makeProgram();
    const state = playingState(0);
    const settler = makeSettler(program, state);
    const outsider = Keypair.generate();

    await expect(
      settler.settle(makePayload({
        roomId:          ROOM_ID,
        winnerId:        outsider.publicKey.toBase58(),
        finalMultiplier: 1,
      })),
    ).rejects.toThrow('not a member');
  });

  // ── 错误处理：链上 is_settled=true → AlreadySettledError ────────────────

  it('链上 isSettled=true → 抛 AlreadySettledError，不发交易', async () => {
    const { program, sendRawTx } = makeProgram({ isSettled: true });
    const state = playingState(0);
    const settler = makeSettler(program, state);

    await expect(
      settler.settle(makePayload({
        roomId:          ROOM_ID,
        winnerId:        player0.publicKey.toBase58(),
        finalMultiplier: 2,
      })),
    ).rejects.toBeInstanceOf(AlreadySettledError);

    expect(sendRawTx).not.toHaveBeenCalled();
  });
});
