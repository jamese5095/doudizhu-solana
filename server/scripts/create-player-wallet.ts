/**
 * create-player-wallet.ts — 生成助记词钱包并充值 SOL + MEME
 */

import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
  getMint,
} from '@solana/spl-token';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import * as bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

const RPC        = 'https://api.devnet.solana.com';
const MINT       = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');
const RELAY_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const SOL_AMOUNT = 0.1 * LAMPORTS_PER_SOL;
const MEME_AMOUNT = 10_000n;

function loadRelayer(): Keypair {
  const raw = JSON.parse(fs.readFileSync(RELAY_PATH, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function sendTx(conn: Connection, tx: Transaction, signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signers[0]!.publicKey;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

async function main() {
  // 1. 生成助记词 + 推导 Solana 密钥对（标准 Phantom 路径 m/44'/501'/0'/0'）
  const mnemonic = bip39.generateMnemonic();
  const seed     = await bip39.mnemonicToSeed(mnemonic);
  const derived  = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
  const wallet   = Keypair.fromSeed(derived.key);

  // 64字节完整私钥的 base58（Phantom「导入私钥」接受此格式）
  const privateKeyBase58 = bs58.encode(wallet.secretKey);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║              新玩家钱包已生成                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\n📍 地址（公钥）:\n   ${wallet.publicKey.toBase58()}`);
  console.log(`\n🔑 私钥（64字节 base58，粘贴进 Phantom「导入私钥」）:\n   ${privateKeyBase58}`);
  console.log(`\n📝 助记词（12个词，可在 Phantom「导入助记词」使用）:\n   ${mnemonic}`);
  console.log('\n══════════════════════════════════════════════════');

  const conn    = new Connection(RPC, 'confirmed');
  const relayer = loadRelayer();

  // 2. 转 SOL
  process.stdout.write('\n转入 0.1 SOL...');
  const solTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: relayer.publicKey,
      toPubkey:   wallet.publicKey,
      lamports:   SOL_AMOUNT,
    }),
  );
  await sendTx(conn, solTx, [relayer]);
  console.log(' ✓');

  // 3. 创建 ATA 并转 MEME
  process.stdout.write('创建代币账户...');
  const relayerAta = await getOrCreateAssociatedTokenAccount(
    conn, relayer, MINT, relayer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  );
  const walletAta = await getOrCreateAssociatedTokenAccount(
    conn, relayer, MINT, wallet.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  );
  console.log(' ✓');

  process.stdout.write(`转入 ${MEME_AMOUNT} MEME...`);
  const mintInfo = await getMint(conn, MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const memeTx = new Transaction().add(
    createTransferCheckedInstruction(
      relayerAta.address, MINT, walletAta.address,
      relayer.publicKey, MEME_AMOUNT, mintInfo.decimals, [], TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendTx(conn, memeTx, [relayer]);
  console.log(' ✓');

  // 4. 验证
  const finalAta = await getOrCreateAssociatedTokenAccount(
    conn, relayer, MINT, wallet.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  );
  const solBal = await conn.getBalance(wallet.publicKey);
  console.log(`\n✅ 充值完成  SOL: ${(solBal / LAMPORTS_PER_SOL).toFixed(4)}  MEME: ${finalAta.amount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
