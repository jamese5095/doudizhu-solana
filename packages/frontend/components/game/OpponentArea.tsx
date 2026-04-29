'use client';

import type { PlayerState } from '@doudizhu/types';
import { PlayerRole } from '@doudizhu/types';
import { CardBack } from './CardView';

interface Props {
  player:        PlayerState;
  isCurrentTurn: boolean;
  layout:        'left' | 'right';
  displayName?:  string;
}

export function OpponentArea({ player, isCurrentTurn, layout, displayName }: Props) {
  const addr       = player.playerId;
  const isBot      = addr.startsWith('bot-');
  const display    = displayName ?? (isBot ? '机器人' : `${addr.slice(0, 4)}…${addr.slice(-4)}`);
  const cardCount  = player.handCards.length;
  const isLandlord = player.role === PlayerRole.Landlord;
  const isLeft     = layout === 'left';

  const visibleCards = Math.min(cardCount, 10);
  const fanHeight    = visibleCards > 0 ? visibleCards * 13 + 48 : 0;

  return (
    <div className={`flex h-full flex-col gap-2 px-2 py-3 ${isLeft ? 'items-start' : 'items-end'}`}>

      {/* 玩家信息行 */}
      <div className={`flex items-center gap-1.5 ${isLeft ? '' : 'flex-row-reverse'}`}>
        {isCurrentTurn && (
          <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-green-400 shadow-lg shadow-green-400/50" />
        )}
        <span className={`font-mono text-[11px] leading-tight ${isCurrentTurn ? 'text-green-300 font-semibold' : 'text-green-300/70'}`}>
          {display}
        </span>
      </div>

      {/* 角色标签 + 剩余张数 */}
      <div className={`flex items-center gap-1.5 ${isLeft ? '' : 'flex-row-reverse'}`}>
        {isLandlord && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400 shadow-inner shadow-amber-500/10">
            ★地主
          </span>
        )}
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
          isCurrentTurn
            ? 'border-green-400/40 bg-green-400/15 text-green-300'
            : 'border-[var(--card-border)] bg-[var(--card-bg)] text-green-300/50'
        }`}>
          {cardCount}张
        </span>
      </div>

      {/* 垂直叠牌扇形 */}
      {cardCount > 0 && (
        <div className="relative flex-shrink-0" style={{ height: fanHeight, width: 32 }}>
          {Array.from({ length: visibleCards }, (_, i) => (
            <div
              key={i}
              className="absolute"
              style={{ top: i * 13, [isLeft ? 'left' : 'right']: 0 }}
            >
              <CardBack size="sm" />
            </div>
          ))}
          {cardCount > 10 && (
            <span
              className="absolute text-[10px] text-green-300/40"
              style={{ top: fanHeight + 2, left: 0 }}
            >
              +{cardCount - 10}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
