'use client';

interface Props {
  onBid:    (bid: boolean) => void;
  disabled: boolean;
}

export function BidPanel({ onBid, disabled }: Props) {
  return (
    <div className="glass-panel flex flex-col items-center gap-4 rounded-2xl p-6 shadow-xl">
      <p className="text-base font-semibold text-green-300">是否叫地主？</p>
      <div className="flex gap-4">
        <button
          onClick={() => onBid(false)}
          disabled={disabled}
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-8 py-3 text-sm font-semibold text-red-300/80 transition-all hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
        >
          不叫
        </button>
        <button
          onClick={() => onBid(true)}
          disabled={disabled}
          className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 px-8 py-3 text-sm font-bold text-[#1a0a00] shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/30 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
        >
          叫地主
        </button>
      </div>
    </div>
  );
}
