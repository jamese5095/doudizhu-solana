import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import idlJson from './idl.json';
import { PROGRAM_ID } from './constants';

export function getAnchorProgram(wallet: AnchorWallet, connection: Connection): Program {
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new Program(idlJson as Idl, provider);
}

export function roomPda(roomIdBytes: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('room'), Buffer.from(roomIdBytes)],
    PROGRAM_ID,
  )[0];
}

export function escrowPda(roomIdBytes: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(roomIdBytes)],
    PROGRAM_ID,
  )[0];
}

export function roomIdToBytes(roomId: string): number[] {
  const clean = roomId.replace(/-/g, '');
  return Array.from(Buffer.from(clean, 'hex'));
}

export function generateRoomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
