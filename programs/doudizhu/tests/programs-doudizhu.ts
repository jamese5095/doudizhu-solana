import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { ProgramsDoudizhu } from "../target/types/programs_doudizhu";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  getMintLen,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { assert } from "chai";

describe("doudizhu - 阶段二", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .ProgramsDoudizhu as Program<ProgramsDoudizhu>;
  const connection = provider.connection;

  // ── 测试用 Keypair ──────────────────────────────────────
  const mintKp = Keypair.generate();
  const player0 = Keypair.generate(); // 测试时将成为地主（winner）
  const player1 = Keypair.generate(); // 农民
  const player2 = Keypair.generate(); // 农民
  const treasury = Keypair.generate();
  // relay = provider.wallet（部署者，同时作为 relay_authority）

  const BASE_SCORE = new BN(1000); // 每人存 1000 DDZ
  const ROOM_ID = Array.from(Buffer.alloc(16, 0x01)); // 固定 room_id 便于测试

  // ── PDA 地址 ──────────────────────────────────────────
  const [roomPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("room"), Buffer.from(ROOM_ID)],
    program.programId
  );
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(ROOM_ID)],
    program.programId
  );

  // ── ATA 地址（Token-2022） ─────────────────────────────
  const escrowAta = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    escrowPda,
    true, // allowOwnerOffCurve = true（PDA 不在 ed25519 曲线上）
    TOKEN_2022_PROGRAM_ID
  );
  const player0Ata = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    player0.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const player1Ata = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    player1.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const player2Ata = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    player2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    treasury.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // ── 辅助函数 ──────────────────────────────────────────
  async function airdrop(pk: PublicKey, sol = 2) {
    const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }

  async function tokenBalance(ata: PublicKey): Promise<bigint> {
    const acct = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
    return acct.amount;
  }

  // ── 初始化阶段：创建 mint + ATA + 铸币 ──────────────────
  before(async () => {
    // 空投 SOL
    await Promise.all([
      airdrop(player0.publicKey),
      airdrop(player1.publicKey),
      airdrop(player2.publicKey),
      airdrop(treasury.publicKey),
      // mintKp 不需要 airdrop，createAccount 时由 payer 出 rent
    ]);

    // 创建 Token-2022 Mint（decimals = 0）
    const mintLen = getMintLen([]);
    const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: mintLen,
        lamports: mintRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKp.publicKey,
        0, // decimals
        provider.wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, createMintTx, [
      provider.wallet.payer,
      mintKp,
    ]);

    // 为每个玩家和 treasury 创建 ATA 并铸 2000 DDZ
    const atasTx = new Transaction();
    for (const [ata, owner] of [
      [player0Ata, player0.publicKey],
      [player1Ata, player1.publicKey],
      [player2Ata, player2.publicKey],
      [treasuryAta, treasury.publicKey],
    ] as [PublicKey, PublicKey][]) {
      atasTx.add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          ata,
          owner,
          mintKp.publicKey,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(
          mintKp.publicKey,
          ata,
          provider.wallet.publicKey,
          2000,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    await sendAndConfirmTransaction(connection, atasTx, [provider.wallet.payer]);
  });

  // ── 测试 1：initialize_room ────────────────────────────
  it("initialize_room: 创建房间和托管账户", async () => {
    await program.methods
      .initializeRoom(
        ROOM_ID,
        0, // BetTier.SMALL
        BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        provider.wallet.publicKey // relay = payer wallet
      )
      .accounts({
        room: roomPda,
        escrow: escrowPda,
        escrowTokenAccount: escrowAta,
        mint: mintKp.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const room = await program.account.roomAccount.fetch(roomPda);
    assert.equal(room.phase, 0, "phase 应为 WaitingToStart(0)");
    assert.equal(room.multiplier, 1, "倍率应初始化为 1");
    assert.equal(room.betTier, 0, "档位应为 SMALL(0)");
    assert.deepEqual(
      room.players.map((p) => p.toBase58()),
      [player0.publicKey, player1.publicKey, player2.publicKey].map((p) =>
        p.toBase58()
      ),
      "玩家地址应正确存储"
    );

    const escrow = await program.account.escrowAccount.fetch(escrowPda);
    assert.equal(escrow.depositFlags, 0, "初始无人存款");
    assert.equal(escrow.isSettled, false, "初始未结算");
  });

  // ── 测试 2-4：join_and_deposit ─────────────────────────
  it("player0 join_and_deposit: 存入 1000 DDZ", async () => {
    await program.methods
      .joinAndDeposit(ROOM_ID)
      .accounts({
        room: roomPda,
        escrow: escrowPda,
        escrowTokenAccount: escrowAta,
        playerTokenAccount: player0Ata,
        mint: mintKp.publicKey,
        player: player0.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player0])
      .rpc();

    const escrow = await program.account.escrowAccount.fetch(escrowPda);
    assert.equal(escrow.depositFlags, 0b001, "bit0 应置位");
    assert.equal(escrow.deposits[0].toNumber(), 1000, "player0 存款 1000");

    await new Promise(r => setTimeout(r, 800)); // wait for token state to propagate
    const bal = await tokenBalance(escrowAta);
    assert.equal(bal, 1000n, "托管 ATA 余额 1000");
  });

  it("player1 join_and_deposit: 存入 1000 DDZ", async () => {
    await program.methods
      .joinAndDeposit(ROOM_ID)
      .accounts({
        room: roomPda,
        escrow: escrowPda,
        escrowTokenAccount: escrowAta,
        playerTokenAccount: player1Ata,
        mint: mintKp.publicKey,
        player: player1.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    const escrow = await program.account.escrowAccount.fetch(escrowPda);
    assert.equal(escrow.depositFlags, 0b011, "bit0+bit1 应置位");
  });

  it("player2 join_and_deposit: 第三人存入后 phase→Bidding", async () => {
    await program.methods
      .joinAndDeposit(ROOM_ID)
      .accounts({
        room: roomPda,
        escrow: escrowPda,
        escrowTokenAccount: escrowAta,
        playerTokenAccount: player2Ata,
        mint: mintKp.publicKey,
        player: player2.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    const room = await program.account.roomAccount.fetch(roomPda);
    assert.equal(room.phase, 1, "三人全到，phase 应推进到 Bidding(1)");

    const escrowBal = await tokenBalance(escrowAta);
    assert.equal(escrowBal, 3000n, "托管 ATA 共 3000 DDZ");
  });

  // ── 测试 5：settle（地主胜） ───────────────────────────
  it("settle: player0 地主胜，multiplier=1，验证余额分配", async () => {
    await new Promise(r => setTimeout(r, 800));
    const p0Before = await tokenBalance(player0Ata);
    const p1Before = await tokenBalance(player1Ata);
    const p2Before = await tokenBalance(player2Ata);
    const tBefore = await tokenBalance(treasuryAta);

    // 地主胜结算（winner=0, landlord=0, multiplier=1）
    // unit = 1000 * 1 = 1000
    // 农民各扣 min(1000, 1000) = 1000
    // total = 2000，fee = 40，landlord_bonus = 1960
    // player0 gets 1000(deposit) + 1960 = 2960
    // player1 gets 0，player2 gets 0
    // treasury gets 40
    await program.methods
      .settle(ROOM_ID, 0, 0, 1) // winner=0, landlord=0, multiplier=1
      .accounts({
        room: roomPda,
        escrow: escrowPda,
        escrowTokenAccount: escrowAta,
        player0TokenAccount: player0Ata,
        player1TokenAccount: player1Ata,
        player2TokenAccount: player2Ata,
        treasuryTokenAccount: treasuryAta,
        mint: mintKp.publicKey,
        relay: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await new Promise(r => setTimeout(r, 800));
    const p0After = await tokenBalance(player0Ata);
    const p1After = await tokenBalance(player1Ata);
    const p2After = await tokenBalance(player2Ata);
    const tAfter = await tokenBalance(treasuryAta);

    // 结算前各玩家余额 = 初始2000 - 存款1000 = 1000
    // 结算后 player0 += 2960，player1 += 0，player2 += 0，treasury += 40
    assert.equal(p0After - p0Before, 2960n, "地主应净获 +2960 DDZ");
    assert.equal(p1After - p1Before, 0n, "农民甲净变化 0");
    assert.equal(p2After - p2Before, 0n, "农民乙净变化 0");
    assert.equal(tAfter - tBefore, 40n, "treasury 获 40 DDZ（2%）");

    const room = await program.account.roomAccount.fetch(roomPda);
    assert.equal(room.phase, 3, "phase 应为 Ended(3)");
    assert.equal(room.winnerIndex, 0, "winnerIndex 应为 0");

    const escrow = await program.account.escrowAccount.fetch(escrowPda);
    assert.equal(escrow.isSettled, true, "is_settled 应为 true");
  });

  // ── 测试 6：拒绝重复结算 ──────────────────────────────
  it("settle: 拒绝重复结算（AlreadySettled）", async () => {
    try {
      await program.methods
        .settle(ROOM_ID, 0, 0, 1)
        .accounts({
          room: roomPda,
          escrow: escrowPda,
          escrowTokenAccount: escrowAta,
          player0TokenAccount: player0Ata,
          player1TokenAccount: player1Ata,
          player2TokenAccount: player2Ata,
          treasuryTokenAccount: treasuryAta,
          mint: mintKp.publicKey,
          relay: provider.wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("应该抛出错误");
    } catch (err: any) {
      assert.include(
        err.toString(),
        "AlreadySettled",
        "错误应为 AlreadySettled"
      );
    }
  });

  // ── 测试 7：拒绝重复存款 ──────────────────────────────
  it("join_and_deposit: 拒绝重复存款（新房间）", async () => {
    // 创建另一个房间验证 AlreadyDeposited
    const ROOM_ID2 = Array.from(Buffer.alloc(16, 0x02));
    const [room2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("room"), Buffer.from(ROOM_ID2)],
      program.programId
    );
    const [escrow2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), Buffer.from(ROOM_ID2)],
      program.programId
    );
    const escrow2Ata = getAssociatedTokenAddressSync(
      mintKp.publicKey,
      escrow2Pda,
      true,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .initializeRoom(
        ROOM_ID2,
        0,
        BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        provider.wallet.publicKey
      )
      .accounts({
        room: room2Pda,
        escrow: escrow2Pda,
        escrowTokenAccount: escrow2Ata,
        mint: mintKp.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .joinAndDeposit(ROOM_ID2)
      .accounts({
        room: room2Pda,
        escrow: escrow2Pda,
        escrowTokenAccount: escrow2Ata,
        playerTokenAccount: player0Ata,
        mint: mintKp.publicKey,
        player: player0.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player0])
      .rpc();

    try {
      await program.methods
        .joinAndDeposit(ROOM_ID2)
        .accounts({
          room: room2Pda,
          escrow: escrow2Pda,
          escrowTokenAccount: escrow2Ata,
          playerTokenAccount: player0Ata,
          mint: mintKp.publicKey,
          player: player0.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player0])
        .rpc();
      assert.fail("应该抛出错误");
    } catch (err: any) {
      assert.include(
        err.toString(),
        "AlreadyDeposited",
        "错误应为 AlreadyDeposited"
      );
    }
  });
});
