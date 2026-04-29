'use client';

import type { ParsedPlay } from '@doudizhu/types';
import { CardView } from './CardView';

interface Props {
  lastPlay:     ParsedPlay | null;
  lastPlayerId: string | null;
  myPlayerId:   string | null;
}

export function CenterPlayArea({ lastPlay, lastPlayerId, myPlayerId }: Props) {
  const isMe = lastPlayerId && myPlayerId && lastPlayerId === myPlayerId;
  const who  = isMe ? '我' : lastPlayerId ? `${lastPlayerId.slice(0, 6)}…` : null;

  if (!lastPlay || lastPlay.cards.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-green-300/40 text-sm">
        请出牌
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {who && (
        <span className="text-xs text-green-300/60">
          {who} 出牌
        </span>
      )}
      <div className="flex animate-[slideUp_0.2s_ease-out] flex-wrap justify-center gap-1">
        {lastPlay.cards.map((c, i) => (
          <CardView key={i} card={c} size="sm" />
        ))}
      </div>
    </div>
  );
}
