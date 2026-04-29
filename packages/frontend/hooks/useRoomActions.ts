'use client';

import { useState, useCallback } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import {
  getAnchorProgram,
  generateRoomId,
  roomIdToBytes,
  roomPda,
  escrowPda,
} from '../lib/anchor';
import {
  MINT,
  TOKEN_PROGRAM_ID,
  ASSOC_TOKEN_PROGRAM_ID,
  RELAY_AUTHORITY,
} from '../lib/constants';
import { BET_TIERS } from '../lib/betTiers';

export interface TxState {
  status:    'idle' | 'sending' | 'confirmed' | 'error';
  signature: string | null;
  error:     string | null;
}

export interface RoomActionsResult {
  createRoom:     (players: [PublicKey, PublicKey, PublicKey], betTier: number) => Promise<{ roomId: string; txSignature: string }>;
  joinAndDeposit: (roomId: string) => Promise<{ txSignature: string }>;
  txState:        TxState;
  resetTx:        () => void;
}

/**
 * Thrown when initialize_room succeeded but join_and_deposit failed.
 * The roomId is preserved so the UI can guide the user to retry via JoinRoomInput.
 */
export class RoomCreatedDepositFailed extends Error {
  constructor(msg: string, public readonly roomId: string) {
    super(msg);
    this.name = 'RoomCreatedDepositFailed';
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('insufficient funds') || msg.includes('Insufficient lamports'))
    return '钱包 SOL 余额不足以支付手续费';
  if (msg.includes('AlreadySettled'))
    return '该房间已结算，请重新创建';
  return '交易失败，请重试';
}

function escrowAta(roomIdBytes: number[]): PublicKey {
  return getAssociatedTokenAddressSync(MINT, escrowPda(roomIdBytes), true, TOKEN_PROGRAM_ID);
}

export function useRoomActions(): RoomActionsResult {
  const { connection }  = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const anchorWallet    = useAnchorWallet();

  const [txState, setTxState] = useState<TxState>({
    status: 'idle', signature: null, error: null,
  });

  const resetTx = useCallback(() => {
    setTxState({ status: 'idle', signature: null, error: null });
  }, []);

  const createRoom = useCallback(async (
    players: [PublicKey, PublicKey, PublicKey],
    betTier: number,
  ): Promise<{ roomId: string; txSignature: string }> => {
    if (!publicKey || !anchorWallet) throw new Error('钱包未连接');

    const tierConfig = BET_TIERS[betTier];
    if (!tierConfig) throw new Error('无效档位');

    const roomId      = generateRoomId();
    const roomIdBytes = roomIdToBytes(roomId);
    const program     = getAnchorProgram(anchorWallet, connection);

    setTxState({ status: 'sending', signature: null, error: null });

    let roomCreated = false;

    try {
      // Step 1: initialize_room
      const initTx = await program.methods
        .initializeRoom(
          roomIdBytes,
          betTier,
          new BN(tierConfig.amount.toString()),
          players,
          RELAY_AUTHORITY,
        )
        .accounts({
          room:                   roomPda(roomIdBytes),
          escrow:                 escrowPda(roomIdBytes),
          escrowTokenAccount:     escrowAta(roomIdBytes),
          mint:                   MINT,
          payer:                  publicKey,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .transaction();

      const { blockhash: bh1 } = await connection.getLatestBlockhash();
      initTx.recentBlockhash  = bh1;
      initTx.feePayer         = publicKey;
      const initSig = await sendTransaction(initTx, connection);
      await connection.confirmTransaction(initSig, 'confirmed');
      roomCreated = true; // ← step 1 confirmed; any further failure is step-2 only

      // Step 2: join_and_deposit (creator)
      // If this step fails, the room already exists on-chain.
      // The caller should catch RoomCreatedDepositFailed and guide the user
      // to retry via joinAndDeposit with the returned roomId.
      const creatorAta = getAssociatedTokenAddressSync(MINT, publicKey, false, TOKEN_PROGRAM_ID);
      const joinTx = await program.methods
        .joinAndDeposit(roomIdBytes)
        .accounts({
          room:                   roomPda(roomIdBytes),
          escrow:                 escrowPda(roomIdBytes),
          escrowTokenAccount:     escrowAta(roomIdBytes),
          playerTokenAccount:     creatorAta,
          mint:                   MINT,
          player:                 publicKey,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .transaction();

      const { blockhash: bh2 } = await connection.getLatestBlockhash();
      joinTx.recentBlockhash = bh2;
      joinTx.feePayer        = publicKey;
      const joinSig = await sendTransaction(joinTx, connection);
      await connection.confirmTransaction(joinSig, 'confirmed');

      setTxState({ status: 'confirmed', signature: joinSig, error: null });
      return { roomId, txSignature: joinSig };
    } catch (err) {
      const msg = friendlyError(err);
      setTxState({ status: 'error', signature: null, error: msg });
      if (roomCreated) {
        // Step 1 already succeeded on-chain — throw with roomId so the form
        // can prompt the user to retry deposit via JoinRoomInput.
        throw new RoomCreatedDepositFailed(msg, roomId);
      }
      throw new Error(msg);
    }
  }, [anchorWallet, connection, publicKey, sendTransaction]);

  const joinAndDeposit = useCallback(async (
    roomId: string,
  ): Promise<{ txSignature: string }> => {
    if (!publicKey || !anchorWallet) throw new Error('钱包未连接');

    const roomIdBytes = roomIdToBytes(roomId);
    const program     = getAnchorProgram(anchorWallet, connection);
    const playerAta   = getAssociatedTokenAddressSync(MINT, publicKey, false, TOKEN_PROGRAM_ID);

    setTxState({ status: 'sending', signature: null, error: null });

    try {
      const tx = await program.methods
        .joinAndDeposit(roomIdBytes)
        .accounts({
          room:                   roomPda(roomIdBytes),
          escrow:                 escrowPda(roomIdBytes),
          escrowTokenAccount:     escrowAta(roomIdBytes),
          playerTokenAccount:     playerAta,
          mint:                   MINT,
          player:                 publicKey,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .transaction();

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash  = blockhash;
      tx.feePayer         = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      setTxState({ status: 'confirmed', signature: sig, error: null });
      return { txSignature: sig };
    } catch (err) {
      const msg = friendlyError(err);
      setTxState({ status: 'error', signature: null, error: msg });
      throw new Error(msg);
    }
  }, [anchorWallet, connection, publicKey, sendTransaction]);

  return { createRoom, joinAndDeposit, txState, resetTx };
}
