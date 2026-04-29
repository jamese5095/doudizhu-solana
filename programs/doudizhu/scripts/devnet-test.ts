/**
 * M3 阶段四 — Devnet 真实代币联调脚本
 *
 * 运行方式：
 *   cd programs/doudizhu
 *   npx ts-node scripts/devnet-test.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  transfer,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ── 配置 ────────────────────────────────────────────────────
const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf");
const MINT = new PublicKey("fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj");
const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/programs_doudizhu.json"),
    "utf8"
  )
);

// ── 工具函数 ────────────────────────────────────────────────
const connection = new Connection(DEVNET_RPC, "confirmed");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadWallet(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function solBalance(pk: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(pk);
  return lamports / LAMPORTS_PER_SOL;
}

async function tokenBalance(ata: PublicKey): Promise<bigint> {
  try {
    const acct = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
    return acct.amount;
  } catch {
    return 0n;
  }
}

function generateRoomId(): number[] {
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf);
}

function roomPda(roomId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("room"), Buffer.from(roomId)],
    PROGRAM_ID
  )[0];
}

function escrowPda(roomId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(roomId)],
    PROGRAM_ID
  )[0];
}

function escrowAta(roomId: number[]): PublicKey {
  return getAssociatedTokenAddressSync(
    MINT,
    escrowPda(roomId),
    true,
    TOKEN_2022_PROGRAM_ID
  );
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Doudizhu Devnet 联调 — 第二步：环境准备");
  console.log("═══════════════════════════════════════════════\n");

  // ── 1. 主钱包（relay / payer）─────────────────────────────
  const payer = loadWallet(path.join(process.env.HOME!, ".config/solana/id.json"));
  const payerBalance = await solBalance(payer.publicKey);
  console.log(`[1] 主钱包地址: ${payer.publicKey.toBase58()}`);
  console.log(`    SOL 余额:   ${payerBalance.toFixed(4)} SOL`);
  if (payerBalance < 0.1) {
    throw new Error("主钱包 SOL 余额不足 0.1 SOL，请先充值！");
  }
  console.log("    ✓ 余额充足\n");

  // ── 2. 生成三个临时测试钱包 ──────────────────────────────
  const player0 = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  console.log("[2] 测试钱包（临时生成）:");
  console.log(`    player0: ${player0.publicKey.toBase58()}`);
  console.log(`    player1: ${player1.publicKey.toBase58()}`);
  console.log(`    player2: ${player2.publicKey.toBase58()}\n`);

  // ── 3. 从主钱包转 SOL 给测试钱包（devnet faucet 限速，改用转账）──
  console.log("[3] 从主钱包转 0.05 SOL 给三个测试钱包...");
  const { Transaction, SystemProgram: SP } = require("@solana/web3.js");
  for (const [label, kp] of [
    ["player0", player0],
    ["player1", player1],
    ["player2", player2],
  ] as [string, Keypair][]) {
    const tx = new (require("@solana/web3.js").Transaction)().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: kp.publicKey,
        lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
      })
    );
    const sig = await connection.sendTransaction(tx, [payer]);
    await connection.confirmTransaction(sig, "confirmed");
    const bal = await solBalance(kp.publicKey);
    console.log(`    ${label}: ${bal.toFixed(4)} SOL ✓`);
    await sleep(500);
  }
  console.log();

  // ── 4. 为三个钱包创建 ATA ────────────────────────────────
  console.log("[4] 创建 Token-2022 ATA（getOrCreate）...");
  const ata0 = await getOrCreateAssociatedTokenAccount(
    connection, payer, MINT, player0.publicKey,
    false, "confirmed", {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const ata1 = await getOrCreateAssociatedTokenAccount(
    connection, payer, MINT, player1.publicKey,
    false, "confirmed", {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const ata2 = await getOrCreateAssociatedTokenAccount(
    connection, payer, MINT, player2.publicKey,
    false, "confirmed", {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  // treasury ATA（主钱包）
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, MINT, payer.publicKey,
    false, "confirmed", {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log(`    player0 ATA: ${ata0.address.toBase58()}`);
  console.log(`    player1 ATA: ${ata1.address.toBase58()}`);
  console.log(`    player2 ATA: ${ata2.address.toBase58()}`);
  console.log(`    treasury ATA: ${treasuryAta.address.toBase58()}\n`);

  // ── 5. 从主钱包转入 10000 DDZ ────────────────────────────
  console.log("[5] 从主钱包转入 10000 DDZ 给每个测试钱包...");
  const payerAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, MINT, payer.publicKey,
    false, "confirmed", {}, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );

  for (const [label, ataAddr] of [
    ["player0", ata0.address],
    ["player1", ata1.address],
    ["player2", ata2.address],
  ] as [string, PublicKey][]) {
    const sig = await transfer(
      connection, payer, payerAta.address, ataAddr,
      payer, 10000n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID
    );
    console.log(`    ${label} 转账: ${sig}`);
    console.log(`    Explorer: ${EXPLORER(sig)}`);
  }

  await sleep(1000);
  const b0 = await tokenBalance(ata0.address);
  const b1 = await tokenBalance(ata1.address);
  const b2 = await tokenBalance(ata2.address);
  console.log(`\n    转账后余额:`);
  console.log(`    player0: ${b0} DDZ ${b0 === 10000n ? "✓" : "✗"}`);
  console.log(`    player1: ${b1} DDZ ${b1 === 10000n ? "✓" : "✗"}`);
  console.log(`    player2: ${b2} DDZ ${b2 === 10000n ? "✓" : "✗"}`);

  if (b0 !== 10000n || b1 !== 10000n || b2 !== 10000n) {
    throw new Error("代币余额不符预期，停止！");
  }
  console.log("\n✅ 环境准备完毕\n");

  // ── Anchor Provider 初始化 ────────────────────────────────
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program(IDL, provider);

  // ═══════════════════════════════════════════════════════════
  // 流程一：正常结算
  // ═══════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════");
  console.log("  流程一：正常结算（地主胜，multiplier=2）");
  console.log("═══════════════════════════════════════════════\n");

  const BASE_SCORE = new BN(1000);
  const roomId1 = generateRoomId();
  const room1 = roomPda(roomId1);
  const escrow1 = escrowPda(roomId1);
  const escrowAta1 = escrowAta(roomId1);

  // 快照 A
  const snapA0 = await tokenBalance(ata0.address);
  const snapA1 = await tokenBalance(ata1.address);
  const snapA2 = await tokenBalance(ata2.address);
  const snapAT = await tokenBalance(treasuryAta.address);
  console.log("快照 A（初始）:");
  console.log(`  player0: ${snapA0} DDZ`);
  console.log(`  player1: ${snapA1} DDZ`);
  console.log(`  player2: ${snapA2} DDZ`);
  console.log(`  treasury: ${snapAT} DDZ\n`);

  // initialize_room
  {
    const sig = await program.methods
      .initializeRoom(
        roomId1, 0, BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        payer.publicKey  // relay = payer
      )
      .accounts({
        room: room1, escrow: escrow1, escrowTokenAccount: escrowAta1,
        mint: MINT, payer: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`[流程一] initialize_room 成功`);
    console.log(`  签名: ${sig}`);
    console.log(`  Explorer: ${EXPLORER(sig)}\n`);
  }

  // 三人 join_and_deposit
  for (const [label, player, ataAddr] of [
    ["player0", player0, ata0.address],
    ["player1", player1, ata1.address],
    ["player2", player2, ata2.address],
  ] as [string, Keypair, PublicKey][]) {
    const sig = await program.methods
      .joinAndDeposit(roomId1)
      .accounts({
        room: room1, escrow: escrow1, escrowTokenAccount: escrowAta1,
        playerTokenAccount: ataAddr, mint: MINT,
        player: player.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();
    await sleep(800);
    const escrowBal = await tokenBalance(escrowAta1);
    console.log(`[流程一] ${label} join_and_deposit`);
    console.log(`  签名: ${sig}`);
    console.log(`  Explorer: ${EXPLORER(sig)}`);
    console.log(`  托管余额: ${escrowBal} DDZ\n`);
  }

  // 快照 B
  await sleep(800);
  const snapB0 = await tokenBalance(ata0.address);
  const snapB1 = await tokenBalance(ata1.address);
  const snapB2 = await tokenBalance(ata2.address);
  const snapBT = await tokenBalance(treasuryAta.address);
  console.log("快照 B（三人存款后）:");
  console.log(`  player0: ${snapB0} DDZ`);
  console.log(`  player1: ${snapB1} DDZ`);
  console.log(`  player2: ${snapB2} DDZ`);
  console.log(`  treasury: ${snapBT} DDZ\n`);

  // settle: winner=0(player0 地主胜), landlord=0, multiplier=2
  // 公式：unit = 1000×2=2000
  //   农民各扣 min(2000,1000)=1000，total=2000
  //   fee=40, landlord_bonus=1960
  //   player0 gets 1000+1960=2960, player1=0, player2=0, treasury=40
  {
    const sig = await program.methods
      .settle(roomId1, 0, 0, 2)
      .accounts({
        room: room1, escrow: escrow1, escrowTokenAccount: escrowAta1,
        player0TokenAccount: ata0.address,
        player1TokenAccount: ata1.address,
        player2TokenAccount: ata2.address,
        treasuryTokenAccount: treasuryAta.address,
        mint: MINT, relay: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`[流程一] settle 成功`);
    console.log(`  签名: ${sig}`);
    console.log(`  Explorer: ${EXPLORER(sig)}\n`);
  }

  // 快照 C
  await sleep(800);
  const snapC0 = await tokenBalance(ata0.address);
  const snapC1 = await tokenBalance(ata1.address);
  const snapC2 = await tokenBalance(ata2.address);
  const snapCT = await tokenBalance(treasuryAta.address);
  console.log("快照 C（结算后）:");
  console.log(`  player0: ${snapC0} DDZ`);
  console.log(`  player1: ${snapC1} DDZ`);
  console.log(`  player2: ${snapC2} DDZ`);
  console.log(`  treasury: ${snapCT} DDZ\n`);

  // 对账（A→C 净变化）
  // unit=1000×2=2000, 农民扣 min(2000,1000)=1000 each, total=2000, fee=40, bonus=1960
  // player0: 存入 -1000, 结算收回 2960 → net = +1960
  // player1: 存入 -1000, 结算收回    0 → net = -1000
  // player2: 存入 -1000, 结算收回    0 → net = -1000
  const expectedDelta0 = 1960n;
  const expectedDelta1 = -1000n;
  const expectedDelta2 = -1000n;
  const expectedFee = 40n;

  const actualDelta0 = snapC0 - snapA0;
  const actualDelta1 = snapC1 - snapA1;
  const actualDelta2 = snapC2 - snapA2;
  const actualFee = snapCT - snapAT;

  const ok = (a: bigint, e: bigint) => a === e ? "✓" : "✗";
  console.log("对账表:");
  console.log("| 钱包     | 快照A   | 快照B   | 快照C   | 实际delta | 预期delta | 是否匹配 |");
  console.log("|----------|---------|---------|---------|-----------|-----------|---------|");
  console.log(`| player0  | ${snapA0.toString().padStart(7)} | ${snapB0.toString().padStart(7)} | ${snapC0.toString().padStart(7)} | ${(actualDelta0>=0n?"+":"")}${actualDelta0.toString().padStart(9)} | ${(expectedDelta0>=0n?"+":"")}${expectedDelta0.toString().padStart(9)} | ${ok(actualDelta0,expectedDelta0)}       |`);
  console.log(`| player1  | ${snapA1.toString().padStart(7)} | ${snapB1.toString().padStart(7)} | ${snapC1.toString().padStart(7)} | ${(actualDelta1>=0n?"+":"")}${actualDelta1.toString().padStart(9)} | ${(expectedDelta1>=0n?"+":"")}${expectedDelta1.toString().padStart(9)} | ${ok(actualDelta1,expectedDelta1)}       |`);
  console.log(`| player2  | ${snapA2.toString().padStart(7)} | ${snapB2.toString().padStart(7)} | ${snapC2.toString().padStart(7)} | ${(actualDelta2>=0n?"+":"")}${actualDelta2.toString().padStart(9)} | ${(expectedDelta2>=0n?"+":"")}${expectedDelta2.toString().padStart(9)} | ${ok(actualDelta2,expectedDelta2)}       |`);
  console.log(`| treasury | ${snapAT.toString().padStart(7)} | ${snapBT.toString().padStart(7)} | ${snapCT.toString().padStart(7)} | ${(actualFee>=0n?"+":"")}${actualFee.toString().padStart(9)} | ${(expectedFee>=0n?"+":"")}${expectedFee.toString().padStart(9)} | ${ok(actualFee,expectedFee)}       |`);

  if (
    actualDelta0 !== expectedDelta0 ||
    actualDelta1 !== expectedDelta1 ||
    actualDelta2 !== expectedDelta2 ||
    actualFee !== expectedFee
  ) {
    throw new Error("流程一对账失败（存在 ✗），停止执行！");
  }
  console.log("\n✅ 流程一对账全部通过\n");

  // ═══════════════════════════════════════════════════════════
  // 流程二：cancel_room
  // ═══════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════");
  console.log("  流程二：cancel_room（仅 player0/1 存款，等待超时）");
  console.log("═══════════════════════════════════════════════\n");

  const roomId2 = generateRoomId();
  const room2 = roomPda(roomId2);
  const escrow2 = escrowPda(roomId2);
  const escrowAta2 = escrowAta(roomId2);

  await program.methods
    .initializeRoom(
      roomId2, 0, BASE_SCORE,
      [player0.publicKey, player1.publicKey, player2.publicKey],
      payer.publicKey
    )
    .accounts({
      room: room2, escrow: escrow2, escrowTokenAccount: escrowAta2,
      mint: MINT, payer: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // player0 和 player1 存款，player2 不存
  for (const [player, ataAddr] of [
    [player0, ata0.address],
    [player1, ata1.address],
  ] as [Keypair, PublicKey][]) {
    await program.methods
      .joinAndDeposit(roomId2)
      .accounts({
        room: room2, escrow: escrow2, escrowTokenAccount: escrowAta2,
        playerTokenAccount: ataAddr, mint: MINT,
        player: player.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();
  }

  await sleep(800);
  const pre0 = await tokenBalance(ata0.address);
  const pre1 = await tokenBalance(ata1.address);
  const pre2 = await tokenBalance(ata2.address);
  console.log("player0 和 player1 存款后余额:");
  console.log(`  player0: ${pre0} DDZ`);
  console.log(`  player1: ${pre1} DDZ`);
  console.log(`  player2: ${pre2} DDZ（未存款）\n`);

  console.log("等待 301 秒超时...");
  for (let i = 301; i > 0; i -= 10) {
    process.stdout.write(`\r  剩余 ${i} 秒...`);
    await sleep(Math.min(10000, i * 1000));
  }
  console.log("\r  超时等待完成！       \n");

  const cancelSig = await program.methods
    .cancelRoom(roomId2)
    .accounts({
      room: room2, escrow: escrow2, escrowTokenAccount: escrowAta2,
      player0TokenAccount: ata0.address,
      player1TokenAccount: ata1.address,
      player2TokenAccount: ata2.address,
      mint: MINT, caller: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`[流程二] cancel_room 成功`);
  console.log(`  签名: ${cancelSig}`);
  console.log(`  Explorer: ${EXPLORER(cancelSig)}\n`);

  await sleep(800);
  const post0 = await tokenBalance(ata0.address);
  const post1 = await tokenBalance(ata1.address);
  const post2 = await tokenBalance(ata2.address);
  console.log("退款后余额:");
  console.log(`  player0: ${post0} DDZ`);
  console.log(`  player1: ${post1} DDZ`);
  console.log(`  player2: ${post2} DDZ`);

  const r0ok = post0 === pre0 + 1000n;
  const r1ok = post1 === pre1 + 1000n;
  const r2ok = post2 === pre2;
  console.log(`\n  player0 退款 1000 DDZ: ${r0ok ? "✓" : "✗"}`);
  console.log(`  player1 退款 1000 DDZ: ${r1ok ? "✓" : "✗"}`);
  console.log(`  player2 余额不变:      ${r2ok ? "✓" : "✗"}`);

  if (!r0ok || !r1ok || !r2ok) {
    throw new Error("流程二 cancel_room 验证失败，停止执行！");
  }
  console.log("\n✅ 流程二 cancel_room 验证通过\n");

  // ═══════════════════════════════════════════════════════════
  // 流程三：dispute_vote
  // ═══════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════");
  console.log("  流程三：dispute_vote（三人全存，2-of-3 均分）");
  console.log("═══════════════════════════════════════════════\n");

  const roomId3 = generateRoomId();
  const room3 = roomPda(roomId3);
  const escrow3 = escrowPda(roomId3);
  const escrowAta3 = escrowAta(roomId3);

  await program.methods
    .initializeRoom(
      roomId3, 0, BASE_SCORE,
      [player0.publicKey, player1.publicKey, player2.publicKey],
      payer.publicKey
    )
    .accounts({
      room: room3, escrow: escrow3, escrowTokenAccount: escrowAta3,
      mint: MINT, payer: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  for (const [player, ataAddr] of [
    [player0, ata0.address],
    [player1, ata1.address],
    [player2, ata2.address],
  ] as [Keypair, PublicKey][]) {
    await program.methods
      .joinAndDeposit(roomId3)
      .accounts({
        room: room3, escrow: escrow3, escrowTokenAccount: escrowAta3,
        playerTokenAccount: ataAddr, mint: MINT,
        player: player.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();
  }

  await sleep(800);
  const dPre0 = await tokenBalance(ata0.address);
  const dPre1 = await tokenBalance(ata1.address);
  const dPre2 = await tokenBalance(ata2.address);

  // player0 投票（第一票）
  {
    const sig = await program.methods
      .disputeVote(roomId3)
      .accounts({
        room: room3, escrow: escrow3, escrowTokenAccount: escrowAta3,
        player0TokenAccount: ata0.address,
        player1TokenAccount: ata1.address,
        player2TokenAccount: ata2.address,
        mint: MINT, voter: player0.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player0])
      .rpc();
    const roomData = await (program.account as any).roomAccount.fetch(room3);
    console.log(`[流程三] player0 投票（第一票）`);
    console.log(`  签名: ${sig}`);
    console.log(`  当前投票状态: ${JSON.stringify(roomData.disputeVotes)}`);
    console.log(`  phase: ${roomData.phase}（应仍为 1）\n`);
  }

  // player1 投票（第二票，触发均分）
  {
    const sig = await program.methods
      .disputeVote(roomId3)
      .accounts({
        room: room3, escrow: escrow3, escrowTokenAccount: escrowAta3,
        player0TokenAccount: ata0.address,
        player1TokenAccount: ata1.address,
        player2TokenAccount: ata2.address,
        mint: MINT, voter: player1.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();
    console.log(`[流程三] player1 投票（第二票，触发均分）`);
    console.log(`  签名: ${sig}`);
    console.log(`  Explorer: ${EXPLORER(sig)}\n`);
  }

  await sleep(800);
  const dPost0 = await tokenBalance(ata0.address);
  const dPost1 = await tokenBalance(ata1.address);
  const dPost2 = await tokenBalance(ata2.address);

  // total=3000, each=1000, rem=0
  const d0ok = dPost0 - dPre0 === 1000n;
  const d1ok = dPost1 - dPre1 === 1000n;
  const d2ok = dPost2 - dPre2 === 1000n;
  console.log("dispute 结算后三人余额:");
  console.log(`  player0: ${dPost0} DDZ（+${dPost0 - dPre0}，预期 +1000） ${d0ok ? "✓" : "✗"}`);
  console.log(`  player1: ${dPost1} DDZ（+${dPost1 - dPre1}，预期 +1000） ${d1ok ? "✓" : "✗"}`);
  console.log(`  player2: ${dPost2} DDZ（+${dPost2 - dPre2}，预期 +1000） ${d2ok ? "✓" : "✗"}`);

  if (!d0ok || !d1ok || !d2ok) {
    throw new Error("流程三 dispute_vote 验证失败，停止执行！");
  }
  console.log("\n✅ 流程三 dispute_vote 验证通过\n");

  // ═══════════════════════════════════════════════════════════
  // 第四步：汇总
  // ═══════════════════════════════════════════════════════════
  const finalTreasury = await tokenBalance(treasuryAta.address);
  const fee1 = finalTreasury - snapAT;

  console.log("═══════════════════════════════════════════════");
  console.log("  最终总结");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Program ID:          CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf`);
  console.log(`  流程一 正常结算:     ✓`);
  console.log(`  流程二 cancel_room:  ✓`);
  console.log(`  流程三 dispute_vote: ✓`);
  console.log(`  Treasury 地址:       ${treasuryAta.address.toBase58()}`);
  console.log(`  Treasury 累计手续费: ${fee1} DDZ`);
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ 执行失败:", err.message || err);
  process.exit(1);
});
