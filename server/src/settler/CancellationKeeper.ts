/**
 * CancellationKeeper — 超时取消守护进程
 *
 * 房间创建后若 30 秒内未获得 3 名玩家全部就绪，自动调用链上 cancel_room
 * 退回已存入玩家的押金。
 *
 * 安全性：cancel_room 指令要求 room.phase == 0（WaitingToStart）且超时；
 * 若游戏已正常开始，链上会拒绝（GameAlreadyStarted），此处安全忽略。
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

// ─── Anchor program interface (minimal subset) ────────────────────────────────

interface CancelRoomAccounts {
  room:                   PublicKey;
  escrow:                 PublicKey;
  escrowTokenAccount:     PublicKey;
  player0TokenAccount:    PublicKey;
  player1TokenAccount:    PublicKey;
  player2TokenAccount:    PublicKey;
  mint:                   PublicKey;
  caller:                 PublicKey;
  tokenProgram:           PublicKey;
  associatedTokenProgram: PublicKey;
  systemProgram:          PublicKey;
}

interface AnchorProgram {
  programId: PublicKey;
  methods: {
    cancelRoom(roomId: number[]): {
      accounts(accts: CancelRoomAccounts): {
        transaction(): Promise<Transaction>;
      };
    };
  };
  provider: {
    connection: SolanaConnection;
  };
}

interface SolanaConnection {
  getLatestBlockhash(commitment?: string): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(raw: Buffer | Uint8Array, opts?: { skipPreflight?: boolean }): Promise<string>;
}

// ─── CancellationKeeper ───────────────────────────────────────────────────────

export class CancellationKeeper {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly programId: PublicKey;
  private readonly connection: SolanaConnection;

  constructor(
    private readonly program: AnchorProgram,
    private readonly relayerKeypair: Keypair,
    private readonly mintAddress: PublicKey,
    /** 延迟多少毫秒后执行取消（应略大于链上超时秒数×1000，默认 35 秒） */
    private readonly delayMs: number = 35_000,
  ) {
    this.programId  = program.programId;
    this.connection = program.provider.connection;
  }

  /**
   * 房间创建后立即调用。
   * 延迟 delayMs 后尝试取消；若房间已进入 Bidding/Playing，链上指令拒绝，静默跳过。
   */
  scheduleCancel(roomId: string, playerPubkeys: [string, string, string]): void {
    if (this.timers.has(roomId)) return; // 已有任务，幂等
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.tryCancel(roomId, playerPubkeys);
    }, this.delayMs);
    this.timers.set(roomId, timer);
  }

  /** 游戏已正常开始（全员就绪），清除待定的超时任务 */
  clearSchedule(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(roomId);
      console.log(`[CancellationKeeper] 取消守护已清除：roomId="${roomId}"`);
    }
  }

  /**
   * 立即触发取消（管理员手动操作或旧房间补救）。
   * @returns 链上交易签名
   */
  async cancelNow(roomId: string, playerPubkeys: [string, string, string]): Promise<string> {
    return this.sendCancelRoom(roomId, playerPubkeys);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async tryCancel(roomId: string, playerPubkeys: [string, string, string]): Promise<void> {
    try {
      const sig = await this.sendCancelRoom(roomId, playerPubkeys);
      console.log(`[CancellationKeeper] 房间 "${roomId}" 超时已取消，押金已退回。tx=${sig}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('GameAlreadyStarted') || msg.includes('AlreadySettled') || msg.includes('InvalidPhase')) {
        // 游戏已正常开始或已结算，无需取消
        console.log(`[CancellationKeeper] 房间 "${roomId}" 已正常进行，跳过取消`);
      } else if (msg.includes('TimeoutNotReached')) {
        // 超时尚未到达（说明链上合约超时 > delayMs）
        // 兼容旧合约（300s 超时）：在 310s 后重试一次
        const retryMs = 310_000;
        console.log(`[CancellationKeeper] 房间 "${roomId}" 链上超时未到达，${retryMs/1000}s 后重试（兼容旧合约 300s 超时）`);
        setTimeout(() => void this.tryCancel(roomId, playerPubkeys), retryMs);
      } else {
        console.error(`[CancellationKeeper] cancel_room 失败，roomId="${roomId}": ${msg}`);
      }
    }
  }

  private async sendCancelRoom(
    roomId: string,
    playerPubkeys: [string, string, string],
  ): Promise<string> {
    const roomIdBytes = this.roomIdToBytes(roomId);

    const [roomPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('room'), Buffer.from(roomIdBytes)],
      this.programId,
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(roomIdBytes)],
      this.programId,
    );
    const escrowAta = getAssociatedTokenAddressSync(
      this.mintAddress, escrowPda, true, TOKEN_2022_PROGRAM_ID,
    );
    const playerPks  = playerPubkeys.map(pk => new PublicKey(pk));
    const playerAtas = playerPks.map(pk =>
      getAssociatedTokenAddressSync(this.mintAddress, pk, false, TOKEN_2022_PROGRAM_ID),
    );

    const accounts: CancelRoomAccounts = {
      room:                   roomPda,
      escrow:                 escrowPda,
      escrowTokenAccount:     escrowAta,
      player0TokenAccount:    playerAtas[0],
      player1TokenAccount:    playerAtas[1],
      player2TokenAccount:    playerAtas[2],
      mint:                   this.mintAddress,
      caller:                 this.relayerKeypair.publicKey,
      tokenProgram:           TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
      systemProgram:          SystemProgram.programId,
    };

    const tx: Transaction = await this.program.methods
      .cancelRoom(roomIdBytes)
      .accounts(accounts)
      .transaction();

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash        = blockhash;
    tx.lastValidBlockHeight   = lastValidBlockHeight;
    tx.feePayer               = this.relayerKeypair.publicKey;
    tx.sign(this.relayerKeypair);

    return this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  }

  /** roomId 字符串 → 16 字节数组（与 Settler.roomIdToBytes 保持一致） */
  private roomIdToBytes(roomId: string): number[] {
    const clean = roomId.replace(/-/g, '');
    if (/^[0-9a-fA-F]{32}$/.test(clean)) {
      return Array.from(Buffer.from(clean, 'hex'));
    }
    // Fallback: UTF-8 填充至 16 字节（兼容旧格式）
    const buf = Buffer.alloc(16, 0);
    Buffer.from(roomId, 'utf8').copy(buf, 0, 0, 16);
    return Array.from(buf);
  }
}
