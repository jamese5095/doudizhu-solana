'use client';

import type { Card } from '@doudizhu/types';
import { CardView } from './CardView';

interface Props {
  cards:        readonly Card[];
  selectedKeys: Set<string>;
  isMyTurn:     boolean;
  isBidding?:   boolean;
  onToggle:     (card: Card) => void;
}

function cardKey(c: Card) { return `${c.suit}_${c.rank}`; }

export function MyHand({ cards, selectedKeys, isMyTurn, isBidding = false, onToggle }: Props) {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank || b.suit - a.suit);

  // lg 牌宽 52px，重叠 -18px，露出 34px/张
  const overlap = sorted.length > 10 ? -20 : 0;
  const gap = 4;

  const interactive = isMyTurn || isBidding;
  const dimmed      = !isMyTurn && !isBidding;

  return (
    <div className="relative flex w-full flex-col items-center overflow-x-auto py-1">
      {/* 轮到我时的光带 */}
      {isMyTurn && (
        <div className="mb-1 h-0.5 w-2/3 rounded-full bg-gradient-to-r from-transparent via-green-400/60 to-transparent blur-[2px]" />
      )}

      <div
        className={[
          'flex items-end justify-center pb-3 pt-1',
          dimmed ? 'opacity-40' : 'opacity-100',
          'transition-opacity duration-200',
        ].join(' ')}
        style={{ gap: overlap === 0 ? `${gap}px` : '0px' }}
      >
        {sorted.map((card, i) => (
          <div
            key={`${cardKey(card)}_${i}`}
            style={overlap !== 0 ? { marginLeft: i === 0 ? 0 : overlap } : undefined}
          >
            <CardView
              card={card}
              size="lg"
              selected={selectedKeys.has(cardKey(card))}
              onClick={interactive ? onToggle : undefined}
              disabled={!interactive}
            />
          </div>
        ))}
      </div>

      {sorted.length === 0 && (
        <p className="py-2 text-sm text-green-300/30">手牌已出完</p>
      )}
    </div>
  );
}
