'use client';

import { TokenBalance } from './lobby/TokenBalance';
import { WalletButton } from './lobby/WalletButton';

export function Navbar() {
  return (
    <nav className="glass-panel">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
        {/* Left: brand */}
        <div className="flex items-center gap-3">
          <span className="text-lg font-black tracking-tight text-gold-gradient">斗地主</span>
          <span className="rounded-full border border-blue-300/30 bg-blue-50/50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-blue-400">
            Devnet
          </span>
        </div>

        {/* Right: balance + wallet */}
        <div className="flex items-center gap-3">
          <TokenBalance />
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
