import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
const { Program, AnchorProvider, Wallet } = anchor;
import { Keypair } from '@solana/web3.js';
import idlJson from '../../../../lib/idl.json';

const DEVNET_RPC  = 'https://api.devnet.solana.com';
const PROGRAM_ID  = new PublicKey('CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf');

function roomPda(roomIdBytes: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('room'), Buffer.from(roomIdBytes)],
    PROGRAM_ID,
  )[0];
}

function roomIdToBytes(roomId: string): number[] {
  return Array.from(Buffer.from(roomId.toLowerCase(), 'hex'));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;

  if (!/^[0-9a-f]{32}$/i.test(roomId)) {
    return NextResponse.json({ error: 'Invalid roomId format' }, { status: 400 });
  }

  try {
    const connection = new Connection(DEVNET_RPC, { commitment: 'confirmed' });
    // Read-only provider with a throwaway keypair
    const dummyWallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
    const program = new Program(idlJson as Idl, provider);

    const roomIdBytes = roomIdToBytes(roomId);
    const pda = roomPda(roomIdBytes);

    const roomAccount = await (program.account as Record<string, { fetch(pk: PublicKey): Promise<unknown> }>)
      .roomAccount.fetch(pda) as { players: PublicKey[]; isSettled?: boolean };

    return NextResponse.json({
      roomId,
      players: roomAccount.players.map((pk: PublicKey) => pk.toBase58()),
    });
  } catch {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
}
