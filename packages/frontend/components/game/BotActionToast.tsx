'use client';

import type { BotActionInfo } from '../../hooks/useGameState';

interface Props { info: BotActionInfo | null; roomId?: string }

export function BotActionToast({ info, roomId }: Props) {
  if (!info) return null;

  const addr    = info.playerId;
  let display  = addr.startsWith('bot-') ? '机器人' : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  if (addr.startsWith('bot-') && roomId) {
    const suffix = `-${roomId.slice(0, 8)}-1`;
    if (addr.endsWith(suffix)) display = '机器人①';
    else display = '机器人②';
  }
  const text    = info.action === 'PLAY'
    ? `出牌 ${info.cards.length} 张`
    : '过牌';

  return (
    <div
      className="fixed left-1/2 z-40 -translate-x-1/2 animate-float-up glass-panel rounded-xl px-5 py-2 text-sm shadow-xl"
      style={{ top: 'calc(3.5rem + 100px)' }}
    >
      <span className="mr-1.5 font-semibold text-blue-400">{display}</span>
      <span className="text-blue-300/80">{text}</span>
    </div>
  );
}
