'use client';

interface Props { multiplier: number }

export function MultiplierBadge({ multiplier }: Props) {
  const isHigh = multiplier >= 4;
  const isExtreme = multiplier >= 8;

  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${
      isExtreme
        ? 'border border-red-500/60 bg-red-500/20 shadow-lg shadow-red-500/20 animate-glow'
        : isHigh
          ? 'border border-red-500/40 bg-red-500/10 animate-glow'
          : 'border border-amber-500/30 bg-amber-500/10'
    }`}>
      {isHigh && <span className="text-[10px]">💣</span>}
      <span className={`font-mono text-base font-black tabular-nums ${
        isExtreme ? 'text-red-400' : isHigh ? 'text-red-400/90' : 'text-amber-400'
      }`}>
        x{multiplier}
      </span>
    </div>
  );
}
