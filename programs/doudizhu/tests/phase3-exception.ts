/**
 * M3 阶段三：异常处理指令测试
 *
 * 使用 solana-bankrun 进行 Clock 推进，覆盖三个场景：
 *   场景 1: cancel_room（超时退款，部分存款）
 *   场景 2: dispute_vote 正常流程（2-of-3 投票均分退款）
 *   场景 3: dispute_vote 权限验证（非玩家 → NotAPlayer）
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";
import type { ProgramTestContext } from "solana-bankrun";
import { ProgramsDoudizhu } from "../target/types/programs_doudizhu";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getMintLen,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";

const IDL = require("../target/idl/programs_doudizhu.json");

describe("doudizhu - 阶段三 (bankrun)", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: Program<ProgramsDoudizhu>;

  const mintKp = Keypair.generate();
  const player0 = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const outsider = Keypair.generate();

  const BASE_SCORE = new BN(1000);

  // 三个房间 ID，各测试场景独立使用
  const ROOM_ID3 = Array.from(Buffer.alloc(16, 0x03)); // cancel_room
  const ROOM_ID4 = Array.from(Buffer.alloc(16, 0x04)); // dispute_vote 正常
  const ROOM_ID5 = Array.from(Buffer.alloc(16, 0x05)); // dispute_vote 权限

  // ── PDA 地址 ────────────────────────────────────────────
  function roomPda(roomId: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("room"), Buffer.from(roomId)],
      new PublicKey(IDL.address)
    )[0];
  }
  function escrowPda(roomId: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), Buffer.from(roomId)],
      new PublicKey(IDL.address)
    )[0];
  }
  function escrowAta(roomId: number[]): PublicKey {
    return getAssociatedTokenAddressSync(
      mintKp.publicKey,
      escrowPda(roomId),
      true,
      TOKEN_2022_PROGRAM_ID
    );
  }

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

  // ── 辅助：读取 Token-2022 ATA 余额 ──────────────────────
  async function tokenBalance(ata: PublicKey): Promise<bigint> {
    const raw = await context.banksClient.getAccount(ata);
    if (!raw) return 0n;
    // Use provider.connection (backed by banksClient) to parse account
    const acct = await getAccount(
      provider.connection,
      ata,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    return acct.amount;
  }

  // ── 辅助：发送原始 Transaction（多签） ──────────────────
  async function sendTx(tx: Transaction, ...signers: Keypair[]): Promise<void> {
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = context.payer.publicKey;
    tx.sign(context.payer, ...signers);
    await context.banksClient.processTransaction(tx);
  }

  // ── Before：初始化 bankrun + mint + ATA ──────────────────
  before(async () => {
    const LAMPORTS = 2 * LAMPORTS_PER_SOL;

    context = await startAnchor(
      ".", // Anchor.toml 所在目录
      [],
      [
        {
          address: player0.publicKey,
          info: {
            lamports: LAMPORTS,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
        {
          address: player1.publicKey,
          info: {
            lamports: LAMPORTS,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
        {
          address: player2.publicKey,
          info: {
            lamports: LAMPORTS,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
        {
          address: outsider.publicKey,
          info: {
            lamports: LAMPORTS,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
      ]
    );

    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = new anchor.Program(IDL, provider);

    // ── 创建 Token-2022 Mint（decimals=0）────────────────
    const mintLen = getMintLen([]);
    const rent = await context.banksClient.getRent();
    const mintLamports = Number(rent.minimumBalance(BigInt(mintLen)));

    await sendTx(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: context.payer.publicKey,
          newAccountPubkey: mintKp.publicKey,
          space: mintLen,
          lamports: mintLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          mintKp.publicKey,
          0,
          context.payer.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      ),
      mintKp
    );

    // ── 为各玩家创建 ATA 并铸 3000 DDZ（足够存款多次）──────
    for (const [ata, owner] of [
      [player0Ata, player0.publicKey],
      [player1Ata, player1.publicKey],
      [player2Ata, player2.publicKey],
    ] as [PublicKey, PublicKey][]) {
      await sendTx(
        new Transaction().add(
          createAssociatedTokenAccountInstruction(
            context.payer.publicKey,
            ata,
            owner,
            mintKp.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
          createMintToInstruction(
            mintKp.publicKey,
            ata,
            context.payer.publicKey,
            3000,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        )
      );
    }
  });

  // ════════════════════════════════════════════════════════════
  // 场景 1：cancel_room（超时退款，仅 player0 已存款）
  // ════════════════════════════════════════════════════════════
  it("cancel_room: 超时后退还 player0 本金，player1/2 不变", async () => {
    const room3 = roomPda(ROOM_ID3);
    const escrow3 = escrowPda(ROOM_ID3);
    const escrowAta3 = escrowAta(ROOM_ID3);

    // 初始化房间
    await program.methods
      .initializeRoom(
        ROOM_ID3,
        0,
        BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        context.payer.publicKey
      )
      .accounts({
        room: room3,
        escrow: escrow3,
        escrowTokenAccount: escrowAta3,
        mint: mintKp.publicKey,
        payer: context.payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // 只有 player0 存款
    await program.methods
      .joinAndDeposit(ROOM_ID3)
      .accounts({
        room: room3,
        escrow: escrow3,
        escrowTokenAccount: escrowAta3,
        playerTokenAccount: player0Ata,
        mint: mintKp.publicKey,
        player: player0.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player0])
      .rpc();

    const p0Before = await tokenBalance(player0Ata);
    const p1Before = await tokenBalance(player1Ata);
    const p2Before = await tokenBalance(player2Ata);

    // 推进时钟 +301 秒
    const currentClock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        currentClock.unixTimestamp + 301n
      )
    );

    // 调用 cancel_room（任何人可调用，这里用 payer）
    await program.methods
      .cancelRoom(ROOM_ID3)
      .accounts({
        room: room3,
        escrow: escrow3,
        escrowTokenAccount: escrowAta3,
        player0TokenAccount: player0Ata,
        player1TokenAccount: player1Ata,
        player2TokenAccount: player2Ata,
        mint: mintKp.publicKey,
        caller: context.payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const p0After = await tokenBalance(player0Ata);
    const p1After = await tokenBalance(player1Ata);
    const p2After = await tokenBalance(player2Ata);

    assert.equal(p0After - p0Before, 1000n, "player0 应退款 1000 DDZ");
    assert.equal(p1After - p1Before, 0n, "player1 未存款，余额不变");
    assert.equal(p2After - p2Before, 0n, "player2 未存款，余额不变");

    const room = await program.account.roomAccount.fetch(room3);
    assert.equal(room.phase, 4, "phase 应为 Cancelled(4)");

    const escrowAcct = await program.account.escrowAccount.fetch(escrow3);
    assert.equal(escrowAcct.isSettled, true, "is_settled 应为 true");
  });

  // ════════════════════════════════════════════════════════════
  // 场景 2：dispute_vote 正常流程（2-of-3 均分退款）
  // ════════════════════════════════════════════════════════════
  it("dispute_vote: 两票达到多数，触发均分退款", async () => {
    const room4 = roomPda(ROOM_ID4);
    const escrow4 = escrowPda(ROOM_ID4);
    const escrowAta4 = escrowAta(ROOM_ID4);

    // 初始化房间
    await program.methods
      .initializeRoom(
        ROOM_ID4,
        0,
        BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        context.payer.publicKey
      )
      .accounts({
        room: room4,
        escrow: escrow4,
        escrowTokenAccount: escrowAta4,
        mint: mintKp.publicKey,
        payer: context.payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // 三人全部存款，phase → Bidding(1)
    for (const [player, ata] of [
      [player0, player0Ata],
      [player1, player1Ata],
      [player2, player2Ata],
    ] as [Keypair, PublicKey][]) {
      await program.methods
        .joinAndDeposit(ROOM_ID4)
        .accounts({
          room: room4,
          escrow: escrow4,
          escrowTokenAccount: escrowAta4,
          playerTokenAccount: ata,
          mint: mintKp.publicKey,
          player: player.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    }

    const p0Before = await tokenBalance(player0Ata);
    const p1Before = await tokenBalance(player1Ata);
    const p2Before = await tokenBalance(player2Ata);

    // player0 投第一票（尚未触发退款）
    await program.methods
      .disputeVote(ROOM_ID4)
      .accounts({
        room: room4,
        escrow: escrow4,
        escrowTokenAccount: escrowAta4,
        player0TokenAccount: player0Ata,
        player1TokenAccount: player1Ata,
        player2TokenAccount: player2Ata,
        mint: mintKp.publicKey,
        voter: player0.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player0])
      .rpc();

    // 中间状态：尚未结算
    const roomMid = await program.account.roomAccount.fetch(room4);
    assert.equal(roomMid.phase, 1, "第一票后 phase 仍为 Bidding(1)");
    assert.deepEqual(
      roomMid.disputeVotes,
      [true, false, false],
      "仅 player0 已投票"
    );

    // player1 投第二票（触发均分退款）
    // total=3000, each=1000, rem=0
    await program.methods
      .disputeVote(ROOM_ID4)
      .accounts({
        room: room4,
        escrow: escrow4,
        escrowTokenAccount: escrowAta4,
        player0TokenAccount: player0Ata,
        player1TokenAccount: player1Ata,
        player2TokenAccount: player2Ata,
        mint: mintKp.publicKey,
        voter: player1.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    const p0After = await tokenBalance(player0Ata);
    const p1After = await tokenBalance(player1Ata);
    const p2After = await tokenBalance(player2Ata);

    // 3000 均分：每人 1000，余数 0
    assert.equal(p0After - p0Before, 1000n, "player0 均分 1000 DDZ");
    assert.equal(p1After - p1Before, 1000n, "player1 均分 1000 DDZ");
    assert.equal(p2After - p2Before, 1000n, "player2 均分 1000 DDZ");

    const room = await program.account.roomAccount.fetch(room4);
    assert.equal(room.phase, 4, "phase 应为 Cancelled(4)");

    const escrowAcct = await program.account.escrowAccount.fetch(escrow4);
    assert.equal(escrowAcct.isSettled, true, "is_settled 应为 true");
  });

  // ════════════════════════════════════════════════════════════
  // 场景 3：dispute_vote 权限验证（outsider → NotAPlayer）
  // ════════════════════════════════════════════════════════════
  it("dispute_vote: 非玩家投票应被拒绝（NotAPlayer）", async () => {
    const room5 = roomPda(ROOM_ID5);
    const escrow5 = escrowPda(ROOM_ID5);
    const escrowAta5 = escrowAta(ROOM_ID5);

    // 初始化房间并三人存款
    await program.methods
      .initializeRoom(
        ROOM_ID5,
        0,
        BASE_SCORE,
        [player0.publicKey, player1.publicKey, player2.publicKey],
        context.payer.publicKey
      )
      .accounts({
        room: room5,
        escrow: escrow5,
        escrowTokenAccount: escrowAta5,
        mint: mintKp.publicKey,
        payer: context.payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    for (const [player, ata] of [
      [player0, player0Ata],
      [player1, player1Ata],
      [player2, player2Ata],
    ] as [Keypair, PublicKey][]) {
      await program.methods
        .joinAndDeposit(ROOM_ID5)
        .accounts({
          room: room5,
          escrow: escrow5,
          escrowTokenAccount: escrowAta5,
          playerTokenAccount: ata,
          mint: mintKp.publicKey,
          player: player.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    }

    // outsider 尝试投票，应报 NotAPlayer
    // outsider 需要一个 ATA，但合约只要求 player0/1/2 的 ATA
    try {
      await program.methods
        .disputeVote(ROOM_ID5)
        .accounts({
          room: room5,
          escrow: escrow5,
          escrowTokenAccount: escrowAta5,
          player0TokenAccount: player0Ata,
          player1TokenAccount: player1Ata,
          player2TokenAccount: player2Ata,
          mint: mintKp.publicKey,
          voter: outsider.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([outsider])
        .rpc();
      assert.fail("应该抛出 NotAPlayer 错误");
    } catch (err: any) {
      assert.include(
        err.toString(),
        "NotAPlayer",
        "错误应为 NotAPlayer"
      );
    }
  });
});
