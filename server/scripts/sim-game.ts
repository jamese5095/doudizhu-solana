/**
 * sim-game.ts — 轻量化完整对局模拟（无浏览器）
 *
 * 运行方式（在 server/ 目录）：
 *   npx tsx scripts/sim-game.ts
 *
 * 前置条件：
 *   1. Redis 运行中
 *   2. 服务器运行中（npm run dev）
 *   3. 已运行过 devnet-setup.ts（test-wallets/ 存在）
 */

import WebSocket from 'ws';
import * as anchor from '@coral-xyz/anchor';
import { BN, Program, AnchorProvider, type Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import type { Card } from '@doudizhu/types';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const RPC             = 'https://api.devnet.solana.com';
const WS_URL          = 'ws://localhost:8080';
const PROGRAM_ID      = new PublicKey('CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf');
const MINT            = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');
const RELAY_AUTHORITY = new PublicKey('FCGAaDzk5KZxsHRpicBbYnXP4jqDyZPo16UfSFdqASWk');
const BASE_SCORE      = new BN(100);  // 练习场 100 MEME

const WALLETS_DIR = path.join(__dirname, 'test-wallets');
const COLORS = ['\x1b[31m', '\x1b[34m', '\x1b[32m'];
const RESET  = '\x1b[0m';

// ─── 工具 ─────────────────────────────────────────────────────────────────────

const log = (idx: number | null, msg: string) => {
  const tag = idx !== null ? `${COLORS[idx]}[玩家${idx + 1}]${RESET}` : '\x1b[33m[系统]\x1b[0m';
  console.log(`${tag} ${msg}`);
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const cardStr = (c: Card) => {
  const s = ['♠','♥','♦','♣','🃏'];
  const r = ['','','','3','4','5','6','7','8','9','10','J','Q','K','A','2','小','大'];
  return `${s[c.suit] ?? '?'}${r[c.rank] ?? c.rank}`;
};

function loadWallet(index: number): Keypair {
  const raw = JSON.parse(
    fs.readFileSync(path.join(WALLETS_DIR, `wallet-${index}.json`), 'utf8'),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(): Idl {
  const candidates = [
    path.join(__dirname, '../../../programs/doudizhu/target/idl/programs_doudizhu.json'),
    path.join(__dirname, '../../packages/frontend/lib/idl.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as Idl;
  }
  throw new Error('IDL 文件未找到');
}

// ─── PDA 助手（与前端 lib/anchor.ts 保持一致）────────────────────────────────

function roomPda(roomIdBytes: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('room'), Buffer.from(roomIdBytes)], PROGRAM_ID,
  )[0];
}

function escrowPda(roomIdBytes: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(roomIdBytes)], PROGRAM_ID,
  )[0];
}

function escrowAta(roomIdBytes: number[]): PublicKey {
  return getAssociatedTokenAddressSync(
    MINT, escrowPda(roomIdBytes), true, TOKEN_2022_PROGRAM_ID,
  );
}

function playerAta(pk: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(MINT, pk, false, TOKEN_2022_PROGRAM_ID);
}

// ─── Anchor Program 工厂 ──────────────────────────────────────────────────────

function makeProgram(payer: Keypair, conn: Connection): Program {
  const wallet   = new anchor.Wallet(payer);
  const provider = new AnchorProvider(conn, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  return new Program(loadIdl(), provider);
}

// ─── 链上操作 ─────────────────────────────────────────────────────────────────

async function sendTx(
  conn: Connection,
  tx: Transaction,
  signers: Keypair[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash      = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer             = signers[0]!.publicKey;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

async function initializeRoom(
  conn: Connection,
  creator: Keypair,
  roomIdBytes: number[],
  players: [Keypair, Keypair, Keypair],
): Promise<string> {
  const program = makeProgram(creator, conn);
  const tx: Transaction = await (program.methods as unknown as {
    initializeRoom: (...a: unknown[]) => { accounts: (x: object) => { transaction: () => Promise<Transaction> } }
  }).initializeRoom(
    roomIdBytes,
    0,                    // bet_tier = SMALL
    BASE_SCORE,
    players.map(p => p.publicKey),
    RELAY_AUTHORITY,
  ).accounts({
    room:                   roomPda(roomIdBytes),
    escrow:                 escrowPda(roomIdBytes),
    escrowTokenAccount:     escrowAta(roomIdBytes),
    mint:                   MINT,
    payer:                  creator.publicKey,
    tokenProgram:           TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram:          SystemProgram.programId,
  }).transaction();

  return sendTx(conn, tx, [creator]);
}

async function joinAndDeposit(
  conn: Connection,
  player: Keypair,
  roomIdBytes: number[],
): Promise<string> {
  const program = makeProgram(player, conn);
  const tx: Transaction = await (program.methods as unknown as {
    joinAndDeposit: (...a: unknown[]) => { accounts: (x: object) => { transaction: () => Promise<Transaction> } }
  }).joinAndDeposit(roomIdBytes)
    .accounts({
      room:                   roomPda(roomIdBytes),
      escrow:                 escrowPda(roomIdBytes),
      escrowTokenAccount:     escrowAta(roomIdBytes),
      playerTokenAccount:     playerAta(player.publicKey),
      mint:                   MINT,
      player:                 player.publicKey,
      tokenProgram:           TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram:          SystemProgram.programId,
    }).transaction();

  return sendTx(conn, tx, [player]);
}

// ─── WebSocket 客户端 ─────────────────────────────────────────────────────────

interface Client {
  ws:       WebSocket;
  idx:      number;
  playerId: string;
  waiters:  Map<string, (msg: Record<string, unknown>) => void>;
}

function connect(idx: number, playerId: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const client: Client = { ws, idx, playerId, waiters: new Map() };
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      // Log unexpected ERROR messages so they don't silently drop
      if (msg['type'] === 'ERROR') {
        log(idx, `[SERVER ERROR] ${String(msg['message'])}`);
      }
      const waiter = client.waiters.get(msg['type'] as string);
      if (waiter) { client.waiters.delete(msg['type'] as string); waiter(msg); }
    });
  });
}

const send = (c: Client, msg: object) => c.ws.send(JSON.stringify(msg));

function waitFor(c: Client, type: string, ms = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), ms);
    c.waiters.set(type, msg => { clearTimeout(t); resolve(msg); });
  });
}

// ─── 游戏状态类型 ─────────────────────────────────────────────────────────────

interface GameState {
  phase:            string;
  currentTurnIndex: 0 | 1 | 2;
  players:          { playerId: string; handCards: Card[] }[];
  lastPlay:         { cards: Card[] } | null;
  lastPlayerId:     string | null;
  multiplier:       number;
  winnerId:         string | null;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m━━━ 斗地主对局模拟开始 ━━━\x1b[0m\n');

  const conn    = new Connection(RPC, 'confirmed');
  const wallets = [loadWallet(0), loadWallet(1), loadWallet(2)] as [Keypair, Keypair, Keypair];

  wallets.forEach((w, i) => log(i, `地址: ${w.publicKey.toBase58()}`));

  // 生成 roomId
  const roomIdBytes = Array.from(crypto.getRandomValues(new Uint8Array(16)));
  const roomIdHex   = Buffer.from(roomIdBytes).toString('hex');
  log(null, `房间 ID: ${roomIdHex}`);

  // ── 1. 链上建房 ──────────────────────────────────────────────────────────────
  log(null, '链上建房（initialize_room）...');
  const initSig = await initializeRoom(conn, wallets[0], roomIdBytes, wallets);
  log(null, `建房成功 ✓  tx: ${initSig.slice(0, 32)}...`);

  // ── 2. 三人存款 ──────────────────────────────────────────────────────────────
  log(null, '三人依次存款（join_and_deposit）...');
  for (let i = 0; i < 3; i++) {
    const sig = await joinAndDeposit(conn, wallets[i]!, roomIdBytes);
    log(i, `存款成功 ✓  tx: ${sig.slice(0, 32)}...`);
  }

  // ── 3. WS 连接 + AUTH + JOIN ──────────────────────────────────────────────────
  log(null, '建立 WebSocket 连接...');
  const clients = await Promise.all(
    wallets.map((w, i) => connect(i, w.publicKey.toBase58())),
  );

  for (const c of clients) {
    send(c, { type: 'AUTH', playerId: c.playerId });
    await waitFor(c, 'AUTH_OK');
    log(c.idx, 'AUTH OK');
  }

  // ── 3b. 创建者在服务器创建 Redis 房间状态 ────────────────────────────────────
  log(null, '在服务器创建房间状态（CREATE_ROOM）...');
  send(clients[0]!, {
    type:    'CREATE_ROOM',
    roomId:  roomIdHex,
    players: wallets.map(w => w.publicKey.toBase58()) as [string, string, string],
    betTier: 0,
  });
  await waitFor(clients[0]!, 'ROOM_CREATED');
  log(null, 'Redis 房间状态创建完成 ✓');

  for (const c of clients) {
    send(c, { type: 'JOIN_ROOM', roomId: roomIdHex });
    const joined = await waitFor(c, 'ROOM_JOINED') as { state: GameState };
    log(c.idx, `加入房间 ✓  阶段: ${joined.state.phase}`);
  }

  // ── 4. 全员准备 ───────────────────────────────────────────────────────────────
  log(null, '全员准备...');
  for (const c of clients) send(c, { type: 'READY' });

  // 共享最新游戏状态（只监听 client 0，避免重复；缓冲已到达的状态）
  let latestState: GameState | null = null;
  const stateBuf: GameState[] = [];
  const stateWaiters: Array<(s: GameState) => void> = [];

  clients[0]!.ws.on('message', raw => {
    const msg = JSON.parse(raw.toString()) as { type: string; state?: GameState };
    if (msg.type === 'GAME_STATE_UPDATE' && msg.state) {
      latestState = msg.state;
      const fn = stateWaiters.shift();
      if (fn) fn(msg.state);        // deliver to waiting caller
      else stateBuf.push(msg.state); // buffer if nobody is waiting yet
    }
  });

  const nextState = (ms = 35_000): Promise<GameState> => {
    if (stateBuf.length > 0) return Promise.resolve(stateBuf.shift()!);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等待状态更新超时')), ms);
      stateWaiters.push(s => { clearTimeout(t); resolve(s); });
    });
  };

  // 等待叫地主阶段（可能收到多个 waiting 状态更新，持续等待直到 bidding）
  let state = await nextState(20_000);
  log(null, `收到状态: ${state.phase}`);
  while (state.phase === 'waiting') {
    state = await nextState(20_000);
    log(null, `收到状态: ${state.phase}`);
  }
  log(null, `游戏阶段: ${state.phase}，当前手牌（玩家1）: ${
    state.players[0]!.handCards.map(cardStr).join(' ')
  }`);

  // ── 5. 叫地主：第一个轮到的人叫 ──────────────────────────────────────────────
  log(null, '叫地主阶段...');
  while (state.phase === 'bidding') {
    const turnIdx = state.currentTurnIndex;
    log(turnIdx, '轮到叫地主 → 叫地主');
    send(clients[turnIdx]!, { type: 'BID', bid: true });
    state = await nextState(15_000);
  }
  log(null, `地主确定 ✓  进入 ${state.phase} 阶段`);
  log(null, `底牌: ${state.players.find(p => p.handCards.length > 17)
    ? '（地主手牌已含底牌）'
    : '已揭示'}`);

  // ── 6. 出牌循环 ───────────────────────────────────────────────────────────────
  log(null, '出牌阶段开始...');
  let round = 0;

  // 每个客户端只能看到自己的手牌（sanitized），只有 turnIdx===0 时才读自己的牌
  // 其他玩家的 handCards 在 client0 的视角下为空，不能用于判断
  while (state.phase === 'playing' && !state.winnerId && round < 100) {
    const turnIdx = state.currentTurnIndex;

    if (turnIdx === 0) {
      // 我们的回合：读 client 0 的手牌（完整）
      const myCards = state.players[0]!.handCards;
      const canFreePlay = state.lastPlay === null || state.lastPlayerId === state.players[0]!.playerId;

      if (canFreePlay) {
        // 首出：打最小单张
        const card = [...myCards].sort((a, b) => a.rank - b.rank)[0]!;
        log(0, `[${round + 1}] 首出 ${cardStr(card)}（手牌${myCards.length}张）`);
        send(clients[0]!, { type: 'PLAY_CARDS', cards: [card] });
      } else {
        // 压牌：pass
        log(0, `[${round + 1}] 不出（手牌${myCards.length}张）`);
        send(clients[0]!, { type: 'PASS' });
      }
    } else {
      // 其他玩家：直接 pass（bot 会在 30s 后代打，但这里我们先 pass）
      log(turnIdx, `[${round + 1}] 不出`);
      send(clients[turnIdx]!, { type: 'PASS' });
    }

    try {
      state = await nextState(35_000);
    } catch {
      log(null, '状态更新超时，检查是否游戏已结束...');
      break;
    }

    if (state.winnerId) {
      const winnerIdx = state.players.findIndex(p => p.playerId === state.winnerId);
      log(winnerIdx >= 0 ? winnerIdx : null, `游戏结束！胜者: ${state.winnerId.slice(0, 8)}...`);
      break;
    }
    round++;
  }

  // ── 7. 等待链上结算 ───────────────────────────────────────────────────────────
  log(null, '等待链上结算（最多 60 秒）...');

  const settlement = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('结算超时（60s）')), 60_000);
    let resolved = false;
    for (const c of clients) {
      c.ws.on('message', raw => {
        if (resolved) return;
        const msg = JSON.parse(raw.toString()) as { type: string };
        if (msg.type === 'SETTLEMENT_CONFIRMED' || msg.type === 'SETTLEMENT_FAILED') {
          resolved = true;
          clearTimeout(t);
          resolve(msg as Record<string, unknown>);
        }
      });
    }
  });

  // ── 8. 打印结果 ───────────────────────────────────────────────────────────────
  console.log('\n\x1b[1m━━━ 结算结果 ━━━\x1b[0m');
  if (settlement['type'] === 'SETTLEMENT_CONFIRMED') {
    const payouts = settlement['payouts'] as { playerId: string; delta: string }[];
    log(null, `交易签名 : ${settlement['txSignature']}`);
    log(null, `最终倍率 : ×${settlement['finalMultiplier']}`);
    log(null, `链上验证 : ${settlement['verified'] ? '✅ 通过' : '⚠️ 未通过'}`);
    payouts.forEach((p, i) => {
      const d    = BigInt(p.delta);
      const sign = d >= 0n ? '+' : '';
      log(i, `${sign}${d.toLocaleString()} MEME`);
    });
    console.log('\n\x1b[1m✅ 完整对局测试通过！\x1b[0m');
  } else {
    log(null, `❌ 结算失败: ${settlement['message'] as string}`);
  }

  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');
  for (const c of clients) c.ws.close();
  process.exit(0);
}

main().catch(e => {
  console.error('\n模拟失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
