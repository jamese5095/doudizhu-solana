'use client';

import { BET_TIERS } from '../../lib/betTiers';

const TIER_ICONS = ['\u2660', '\u2666', '\u2663', '\u2665'];

interface Props {
  selected: number | null;
  balance:  bigint;
  onChange: (tier: number) => void;
}

export function BetTierSelector({ selected, balance, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {BET_TIERS.map(({ tier, name, amount, desc }, idx) => {
        const affordable = balance >= amount;
        const isSelected = selected === tier;

        return (
          <button
            key={tier}
            disabled={!affordable}
            onClick={() => affordable && onChange(tier)}
            className={[
              'group relative flex flex-col items-center rounded-xl border p-3.5 text-center transition-all duration-200',
              isSelected
                ? 'border-[#6d9a80]/30 bg-[#6d9a80]/[0.06] shadow-sm'
                : 'border-[rgba(0,0,0,0.04)] bg-[#f4f1ec] hover:border-[rgba(0,0,0,0.08)] hover:bg-[#f0ede7]',
              affordable
                ? 'cursor-pointer active:scale-[0.97]'
                : 'opacity-35 cursor-not-allowed',
            ].join(' ')}
          >
            {!affordable && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-red-50/60 px-1.5 py-0.5 text-[8px] font-medium text-red-400/70">
                不足
              </span>
            )}
            <span className={`mb-1 text-xl ${isSelected ? 'opacity-70' : 'opacity-25'} transition-opacity duration-200`}>
              {TIER_ICONS[idx]}
            </span>
            <span className={`text-xs font-semibold ${isSelected ? 'text-[#504a44]' : 'text-[#8a847e]'}`}>
              {name}
            </span>
            <span className="mt-0.5 text-[10px] text-[#b0aaa3]">{desc}</span>
            <span className={`mt-2 font-mono text-xs font-bold ${isSelected ? 'text-[#b8960b]/80' : 'text-[#b0aaa3]'}`}>
              {amount.toLocaleString()}
            </span>
            {isSelected && (
              <div className="absolute -bottom-px left-1/2 h-[2px] w-2/3 -translate-x-1/2 rounded-full bg-gradient-to-r from-transparent via-[#6d9a80]/40 to-transparent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
