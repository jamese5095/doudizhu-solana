/**
 * Settler Devnet 集成测试 @devnet
 *
 * 需要真实 Devnet 连接和主钱包（~/.config/solana/id.json 有足够 SOL）。
 * 在 CI 环境中通过 SKIP_DEVNET=1 环境变量跳过。
 *
 * 运行方式：
 *   cd server && npx jest devnet-settle --testTimeout=120000
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  transfer,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { BetTier, GamePhase, PlayerRole } from '@doudizhu/types';
import { RoomManager } from '../room/RoomManager';
import { Settler } from './Settler';

// ─── 跳过条件 ─────────────────────────────────────────────────────────────────

const SKIP = process.env.SKIP_DEVNET === '1';
const describeOrSkip = SKIP ? describe.skip : describe;

// ─── 配置 ────────────────────────────────────────────────────────────────────

const DEVNET_RPC  = 'https://api.devnet.solana.com';
const PROGRAM_ID  = new PublicKey('CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf');
const MINT        = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');
const TREASURY_PK = new PublicKey('FCGAaDzk5KZxsHRpicBbYnXP4jqDyZPo16UfSFdqASWk');

const IDL_PATH = path.join(
  __dirname,
  '../../..', // settler → src → server → doudizhu-solana (monorepo root)
  'programs/doudizhu/target/idl/programs_doudizhu.json',
);

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

function generateRoomId(): string {
  // 生成 16 字节随机值，编码为 32 位十六进制（Settler roomId 格式）
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('hex');
}

function roomPda(roomId: string): PublicKey {
  const bytes = Buffer.from(roomId, 'hex');
  return PublicKey.findProgramAddressSync([Buffer.from('room'), bytes], PROGRAM_ID)[0];
}

function escrowPda(roomId: string): PublicKey {
  const bytes = Buffer.from(roomId, 'hex');
  return PublicKey.findProgramAddressSync([Buffer.from('escrow'), bytes], PROGRAM_ID)[0];
}

function escrowAta(roomId: string): PublicKey {
  return getAssociatedTokenAddressSync(MINT, escrowPda(roomId), true, TOKEN_2022_PROGRAM_ID);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const acct = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
    return acct.amount;
  } catch {
    return 0n;
  }
}

function paddedNum(n: bigint, width = 7): string {
  return n.toString().padStart(width);
}

function okMark(a: bigint, e: bigint): string {
  return a === e ? '✓' : '✗';
}

// ─── 集成测试 ─────────────────────────────────────────────────────────────────

describeOrSkip('Settler — Devnet 真实结算集成测试 @devnet', () => {
  let payer:   Keypair;
  let player0: Keypair;
  let player1: Keypair;
  let player2: Keypair;
  let connection: Connection;
  let program: Program;
  let treasuryAta: PublicKey;

  beforeAll(async () => {
    const solanaConfig = path.join(process.env.HOME!, '.config/solana/id.json');
    if (!fs.existsSync(solanaConfig)) {
      throw new Error('主钱包不存在：~/.config/solana/id.json');
    }

    payer     = loadWallet(solanaConfig);
    player0   = Keypair.generate();
    player1   = Keypair.generate();
    player2   = Keypair.generate();
    connection = new Connection(DEVNET_RPC, 'confirmed');

    const solBal = await connection.getBalance(payer.publicKey);
    if (solBal < 0.2 * LAMPORTS_PER_SOL) {
      throw new Error(`主钱包余额不足（${solBal / LAMPORTS_PER_SOL} SOL），需要 ≥0.2`);
    }

    // Anchor Provider
    const wallet   = new anchor.Wallet(payer);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
    program = new Program(idl, provider);

    // 给测试钱包转 SOL
    const { Transaction: Tx, SystemProgram: SP } = require('@solana/web3.js');
    for (const kp of [player0, player1, player2]) {
      const tx = new Tx().add(
        SP.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: Math.floor(0.05 * LAMPORTS_PER_SOL) })
      );
      const sig = await connection.sendTransaction(tx, [payer]);
      await connection.confirmTransaction(sig, 'confirmed');
    }

    // 创建 ATA 并转入代币
    const payerAta = await getOrCreateAssociatedTokenAccount(
      connection, payer, MINT, payer.publicKey, false, 'confirmed', {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    treasuryAta = getAssociatedTokenAddressSync(MINT, TREASURY_PK, false, TOKEN_2022_PROGRAM_ID);

    for (const kp of [player0, player1, player2]) {
      await getOrCreateAssociatedTokenAccount(
        connection, payer, MINT, kp.publicKey, false, 'confirmed', {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const playerAta = getAssociatedTokenAddressSync(MINT, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const sig = await transfer(
        connection, payer, payerAta.address, playerAta,
        payer, 5000n, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID
      );
      await connection.confirmTransaction(sig, 'confirmed');
    }
    await sleep(500);
  }, 120_000);

  // ── 流程：地主胜，multiplier=2 ──────────────────────────────────────────

  it('完整结算流程：地主(p0)胜，multiplier=2，对账表全 ✓', async () => {
    const BASE_SCORE = new BN(1000);
    const roomId  = generateRoomId();
    const roomIdBytes = Array.from(Buffer.from(roomId, 'hex'));

    const ata0 = getAssociatedTokenAddressSync(MINT, player0.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const ata1 = getAssociatedTokenAddressSync(MINT, player1.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const ata2 = getAssociatedTokenAddressSync(MINT, player2.publicKey, false, TOKEN_2022_PROGRAM_ID);

    // 快照 A
    const snapA0 = await tokenBalance(connection, ata0);
    const snapA1 = await tokenBalance(connection, ata1);
    const snapA2 = await tokenBalance(connection, ata2);
    const snapAT = await tokenBalance(connection, treasuryAta);

    // initialize_room
    await program.methods
      .initializeRoom(
        roomIdBytes, 0, BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        payer.publicKey,
      )
      .accounts({
        room: roomPda(roomId), escrow: escrowPda(roomId),
        escrowTokenAccount: escrowAta(roomId),
        mint: MINT, payer: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // 三人 join_and_deposit
    for (const [kp, ata] of [[player0, ata0], [player1, ata1], [player2, ata2]] as [Keypair, PublicKey][]) {
      await program.methods.joinAndDeposit(roomIdBytes)
        .accounts({
          room: roomPda(roomId), escrow: escrowPda(roomId),
          escrowTokenAccount: escrowAta(roomId),
          playerTokenAccount: ata, mint: MINT,
          player: kp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }
    await sleep(800);

    // 快照 B
    const snapB0 = await tokenBalance(connection, ata0);
    const snapB1 = await tokenBalance(connection, ata1);
    const snapB2 = await tokenBalance(connection, ata2);

    // 构建 Settler（payer 是 relay）
    const redis = new RedisMock() as unknown as Redis;
    const rm    = new RoomManager(redis);

    // 写入 Redis 游戏状态（simulate 游戏结束后的状态）
    const gameState = {
      roomId,
      phase:            GamePhase.Ended,
      landlordIndex:    0,
      currentTurnIndex: 0,
      lastPlay:         null,
      lastPlayerId:     null,
      kitty:            [],
      multiplier:       2,
      winnerId:         player0.publicKey.toBase58(),
      betTier:          BetTier.Small,
      biddingPassCount: 0,
      players: [
        { playerId: player0.publicKey.toBase58(), role: PlayerRole.Landlord, handCards: [], isReady: true },
        { playerId: player1.publicKey.toBase58(), role: PlayerRole.Farmer,   handCards: [], isReady: true },
        { playerId: player2.publicKey.toBase58(), role: PlayerRole.Farmer,   handCards: [], isReady: true },
      ],
    };
    await redis.set(`room:${roomId}`, JSON.stringify(gameState), 'EX', 3600);
    await redis.set(`player:${player0.publicKey.toBase58()}`, roomId, 'EX', 3600);
    await redis.set(`player:${player1.publicKey.toBase58()}`, roomId, 'EX', 3600);
    await redis.set(`player:${player2.publicKey.toBase58()}`, roomId, 'EX', 3600);

    const settler = new Settler(
      rm,
      program as never,
      payer,    // relay = payer
      MINT,
      treasuryAta,
    );

    // ── 调用 settler.settle ──────────────────────────────────────────────────

    const result = await settler.settle({
      roomId,
      winnerId:        player0.publicKey.toBase58(),
      finalMultiplier: 2,
      bombCount:       0,
      rocketUsed:      false,
      isSpring:        false,
      isAntiSpring:    false,
      gameDurationSecs: 180,
    });

    await sleep(800);

    // 快照 C
    const snapC0 = await tokenBalance(connection, ata0);
    const snapC1 = await tokenBalance(connection, ata1);
    const snapC2 = await tokenBalance(connection, ata2);
    const snapCT = await tokenBalance(connection, treasuryAta);

    // 对账表
    // unit=2000, farmer deduct=1000 each, total=2000, fee=40, landlord_bonus=1960
    const expD0 = 1960n;
    const expD1 = -1000n;
    const expD2 = -1000n;
    const expFee = 40n;

    const actD0 = snapC0 - snapA0;
    const actD1 = snapC1 - snapA1;
    const actD2 = snapC2 - snapA2;
    const actFee = snapCT - snapAT;

    console.log('\n对账表（A=存款前，B=存款后，C=结算后）:');
    console.log('| 钱包     | A       | B       | C       | 实际delta | 预期delta | 匹配 |');
    console.log('|----------|---------|---------|---------|-----------|-----------|------|');
    console.log(`| player0  | ${paddedNum(snapA0)} | ${paddedNum(snapB0)} | ${paddedNum(snapC0)} | ${(actD0 >= 0n ? '+' : '') + paddedNum(actD0, 9)} | ${(expD0 >= 0n ? '+' : '') + paddedNum(expD0, 9)} | ${okMark(actD0, expD0)}    |`);
    console.log(`| player1  | ${paddedNum(snapA1)} | ${paddedNum(snapB1)} | ${paddedNum(snapC1)} | ${(actD1 >= 0n ? '+' : '') + paddedNum(actD1, 9)} | ${(expD1 >= 0n ? '+' : '') + paddedNum(expD1, 9)} | ${okMark(actD1, expD1)}    |`);
    console.log(`| player2  | ${paddedNum(snapA2)} | ${paddedNum(snapB2)} | ${paddedNum(snapC2)} | ${(actD2 >= 0n ? '+' : '') + paddedNum(actD2, 9)} | ${(expD2 >= 0n ? '+' : '') + paddedNum(expD2, 9)} | ${okMark(actD2, expD2)}    |`);
    console.log(`| treasury | ${paddedNum(snapAT)} | ${paddedNum(snapAT)} | ${paddedNum(snapCT)} | +${paddedNum(actFee, 9)} | +${paddedNum(expFee, 9)} | ${okMark(actFee, expFee)}    |`);
    console.log(`\ntxSignature: ${result.txSignature}`);
    console.log(`verified: ${result.verified}`);

    // Jest 断言
    expect(actD0).toBe(expD0);
    expect(actD1).toBe(expD1);
    expect(actD2).toBe(expD2);
    expect(actFee).toBe(expFee);
    expect(result.txSignature).toBeTruthy();
    expect(result.winnerId).toBe(player0.publicKey.toBase58());
    expect(result.finalMultiplier).toBe(2);

    // Settler 自身计算的 payout
    const p0payout = result.payouts.find(p => p.playerId === player0.publicKey.toBase58())!;
    const p1payout = result.payouts.find(p => p.playerId === player1.publicKey.toBase58())!;
    expect(p0payout.delta).toBe(1960n);
    expect(p1payout.delta).toBe(-1000n);
    expect(result.fee).toBe(40n);
  }, 120_000);
});
