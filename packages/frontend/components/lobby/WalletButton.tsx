'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

export function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (connecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 rounded-xl border border-[rgba(0,0,0,0.05)] bg-[#f4f1ec] px-3.5 py-1.5 text-xs text-[#8a847e]"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#6d9a80]" />
        连接中...
      </button>
    );
  }

  if (publicKey) {
    const addr = publicKey.toBase58();
    const display = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 rounded-xl border border-[rgba(0,0,0,0.05)] bg-[#f4f1ec] px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#6d9a80]" />
          <span className="font-mono text-[11px] text-[#6a645e]">{display}</span>
        </div>
        <button
          onClick={() => void disconnect()}
          className="rounded-lg border border-[rgba(0,0,0,0.05)] px-2 py-1.5 text-[10px] text-[#b0aaa3] transition-all duration-200 hover:border-red-300/40 hover:text-red-400/70"
        >
          断开
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="btn-glow rounded-xl bg-gradient-to-r from-[#6d9a80] to-[#7daa90] px-5 py-2 text-xs font-bold text-white/90 shadow-sm transition-all duration-200 hover:shadow-md active:scale-95"
    >
      <span>连接钱包</span>
    </button>
  );
}
