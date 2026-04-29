'use client';

import { use } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSearchParams } from 'next/navigation';
import { GameTable } from '../../../components/game/GameTable';

interface Props {
  params: Promise<{ roomId: string }>;
}

export default function GamePage({ params }: Props) {
  const { roomId } = use(params);
  const { publicKey } = useWallet();
  const searchParams = useSearchParams();

  // Solo mode: playerId comes from query param, not wallet
  const soloPlayerId = searchParams.get('solo') === '1' ? searchParams.get('playerId') : null;
  const playerId = soloPlayerId ?? publicKey?.toBase58() ?? null;

  return <GameTable roomId={roomId} playerId={playerId} />;
}
