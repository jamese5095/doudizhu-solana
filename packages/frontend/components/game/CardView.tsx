'use client';

import type { Card } from '@doudizhu/types';
import { Suit, Rank } from '@doudizhu/types';

const RANK_LABELS: Record<number, string> = {
  [Rank.Three]: '3', [Rank.Four]: '4', [Rank.Five]: '5', [Rank.Six]: '6',
  [Rank.Seven]: '7', [Rank.Eight]: '8', [Rank.Nine]: '9', [Rank.Ten]: '10',
  [Rank.Jack]: 'J', [Rank.Queen]: 'Q', [Rank.King]: 'K', [Rank.Ace]: 'A',
  [Rank.Two]: '2', [Rank.SmallJoker]: '小', [Rank.BigJoker]: '大',
};
const SUIT_SYMBOLS: Record<number, string> = {
  [Suit.Spade]: '♠', [Suit.Heart]: '♥', [Suit.Diamond]: '♦', [Suit.Club]: '♣',
};

function isRed(card: Card): boolean {
  return card.suit === Suit.Heart || card.suit === Suit.Diamond || card.rank === Rank.BigJoker;
}

export interface CardViewProps {
  card:      Card;
  selected?: boolean;
  onClick?:  (card: Card) => void;
  size?:     'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function CardView({ card, selected = false, onClick, size = 'md', disabled }: CardViewProps) {
  const red    = isRed(card);
  const label  = RANK_LABELS[card.rank] ?? '?';
  const suit   = SUIT_SYMBOLS[card.suit] ?? '';
  const isJoker = card.suit === Suit.Joker;

  const sizeMap = {
    sm: 'w-8 h-12 text-[10px] rounded',
    md: 'w-10 h-14 text-xs rounded-md',
    lg: 'w-[52px] h-[72px] text-sm rounded-lg',
  };

  const jokerGlow = card.rank === Rank.BigJoker
    ? 'shadow-[0_0_8px_rgba(239,68,68,0.4)]'
    : card.rank === Rank.SmallJoker
      ? 'shadow-[0_0_8px_rgba(59,130,246,0.4)]'
      : '';

  return (
    <div
      onClick={() => !disabled && onClick?.(card)}
      className={[
        'relative flex flex-col justify-between px-0.5 py-0.5 select-none',
        'transition-all duration-150 ease-out',
        'bg-gradient-to-br from-[#fffff5] to-[#f5f0e0]',
        sizeMap[size],
        selected
          ? '-translate-y-3 border-2 border-amber-400 shadow-lg shadow-amber-400/30 scale-105'
          : 'border border-[#d5d0c0] hover:-translate-y-1 hover:shadow-md',
        red ? 'text-red-600' : 'text-gray-800',
        !disabled && onClick ? 'cursor-pointer active:scale-95' : '',
        jokerGlow,
      ].join(' ')}
    >
      {/* 左上角标 */}
      <div className="flex flex-col items-start leading-none">
        <span className="font-bold">{label}</span>
        {!isJoker && <span className="text-[0.65em] -mt-0.5">{suit}</span>}
      </div>
      {/* 中央大花色（仅 md/lg 显示） */}
      {size !== 'sm' && !isJoker && (
        <span className={`absolute inset-0 flex items-center justify-center ${size === 'lg' ? 'text-xl' : 'text-base'} opacity-25 pointer-events-none`}>
          {suit}
        </span>
      )}
      {/* 王牌中央标记 */}
      {isJoker && (
        <span className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
          card.rank === Rank.BigJoker ? 'text-red-500' : 'text-blue-500'
        } ${size === 'lg' ? 'text-lg' : 'text-xs'} font-black opacity-40`}>
          {card.rank === Rank.BigJoker ? '王' : '王'}
        </span>
      )}
      {/* 右下角标（180° 旋转） */}
      <div className="flex flex-col items-end leading-none rotate-180">
        <span className="font-bold">{label}</span>
        {!isJoker && <span className="text-[0.65em] -mt-0.5">{suit}</span>}
      </div>
    </div>
  );
}

/** Card back (hidden hand) */
export function CardBack({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm' ? 'w-8 h-12 rounded' : 'w-10 h-14 rounded-md';
  return (
    <div className={`${sizeClasses} border border-blue-900/60 bg-gradient-to-br from-blue-800 via-blue-900 to-blue-950 shadow-sm`}>
      <div className="h-full w-full rounded-[inherit] border border-blue-700/20 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(59,130,246,0.08)_3px,rgba(59,130,246,0.08)_6px)]" />
    </div>
  );
}
