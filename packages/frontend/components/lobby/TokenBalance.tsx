'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useTokenBalance } from '../../hooks/useTokenBalance';

function formatAmount(n: bigint): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function TokenBalance() {
  const { publicKey } = useWallet();
  const { balance, loading } = useTokenBalance();

  if (!publicKey) {
    return <span className="text-xs text-[#b0aaa3]">-- MEME</span>;
  }

  if (loading && balance === 0n) {
    return <span className="text-xs text-[#b0aaa3]">... MEME</span>;
  }

  const isLow = balance < 100n;
  return (
    <span className={`rounded-lg border border-[rgba(0,0,0,0.05)] bg-[#f4f1ec] px-2.5 py-1 font-mono text-xs font-medium ${isLow ? 'text-amber-700/70' : 'text-[#6a645e]'}`}>
      {formatAmount(balance)} <span className="text-[#b0aaa3]">MEME</span>
    </span>
  );
}
