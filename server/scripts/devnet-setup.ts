/**
 * devnet-setup.ts — 一次性初始化三个测试钱包
 *
 * 运行方式（在 server/ 目录）：
 *   npx tsx scripts/devnet-setup.ts
 *
 * 完成后在 scripts/test-wallets/ 生成：
 *   wallet-0.json / wallet-1.json / wallet-2.json
 *
 * 每个钱包充值：0.5 SOL（从中继器转账）+ 5000 MEME（从中继器转账）
 * 不依赖 devnet airdrop（限流严重），直接用中继器余额。
 */

import {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL,
  SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const RPC         = 'https://api.devnet.solana.com';
const MINT        = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');
const MEME_AMOUNT = 5_000n;
const SOL_AMOUNT  = 0.3 * LAMPORTS_PER_SOL;   // 0.3 SOL 足够数十笔交易

const WALLETS_DIR = path.join(__dirname, 'test-wallets');
const RELAY_PATH  = path.join(process.env.HOME!, '.config/solana/id.json');

function loadRelayer(): Keypair {
  const raw = JSON.parse(fs.readFileSync(RELAY_PATH, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function getOrCreateWallet(index: number): Keypair {
  const filePath = path.join(WALLETS_DIR, `wallet-${index}.json`);
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as number[];
    const kp  = Keypair.fromSecretKey(Uint8Array.from(raw));
    console.log(`  [${index}] 已存在：${kp.publicKey.toBase58()}`);
    return kp;
  }
  const kp = Keypair.generate();
  fs.mkdirSync(WALLETS_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`  [${index}] 新建：${kp.publicKey.toBase58()}`);
  return kp;
}

async function transferSol(
  conn: Connection,
  from: Keypair,
  to: PublicKey,
  lamports: number,
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
  );
  await sendAndConfirmTransaction(conn, tx, [from], { commitment: 'confirmed' });
}

async function main() {
  const conn    = new Connection(RPC, 'confirmed');
  const relayer = loadRelayer();

  console.log(`\n中继器地址：${relayer.publicKey.toBase58()}`);
  const relayerBal = await conn.getBalance(relayer.publicKey);
  console.log(`中继器 SOL 余额：${(relayerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (relayerBal < 3 * SOL_AMOUNT + 0.01 * LAMPORTS_PER_SOL) {
    throw new Error('中继器 SOL 不足，请先给中继器充值');
  }

  console.log('\n── 生成/加载测试钱包 ──');
  const wallets = [0, 1, 2].map(i => getOrCreateWallet(i));

  // 中继器的 MEME ATA
  const relayerAta = await getOrCreateAssociatedTokenAccount(
    conn, relayer, MINT, relayer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  );
  console.log(`\n中继器 MEME 余额：${relayerAta.amount}\n`);

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i]!;
    console.log(`── 初始化钱包 ${i}：${wallet.publicKey.toBase58()} ──`);

    // SOL 转账
    const solBal = await conn.getBalance(wallet.publicKey);
    if (solBal < 0.1 * LAMPORTS_PER_SOL) {
      process.stdout.write('  转账 0.3 SOL...');
      await transferSol(conn, relayer, wallet.publicKey, SOL_AMOUNT);
      console.log(' ✓');
    } else {
      console.log(`  SOL 余额充足（${(solBal / LAMPORTS_PER_SOL).toFixed(4)} SOL），跳过`);
    }

    // MEME ATA + 转账
    process.stdout.write('  创建 MEME ATA...');
    const walletAta = await getOrCreateAssociatedTokenAccount(
      conn, relayer, MINT, wallet.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
    );
    console.log(` ✓ (${walletAta.address.toBase58().slice(0, 8)}...)`);

    if (BigInt(walletAta.amount) < 1_000n) {
      process.stdout.write(`  转账 ${MEME_AMOUNT} MEME...`);
      await transfer(
        conn, relayer,
        relayerAta.address, walletAta.address,
        relayer, MEME_AMOUNT, [], undefined, TOKEN_2022_PROGRAM_ID,
      );
      console.log(' ✓');
    } else {
      console.log(`  MEME 余额充足（${walletAta.amount}），跳过`);
    }
    console.log();
  }

  console.log('✅ 初始化完成！\n');
  console.log('三个测试钱包地址：');
  wallets.forEach((w, i) => {
    console.log(`  玩家 ${i + 1}：${w.publicKey.toBase58()}`);
  });
  console.log('\n下一步：');
  console.log('  1. docker-compose up -d          # 启动 Redis + PostgreSQL');
  console.log('  2. npm run dev                   # 在 server/ 目录，启动服务器');
  console.log('  3. npm run dev                   # 在 packages/frontend/ 目录，启动前端');
  console.log('  4. npx tsx scripts/open-game.ts  # 在 server/ 目录，打开三个游戏窗口');
}

main().catch(e => {
  console.error('\n初始化失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
