'use client';

import type { ParsedPlay, Card } from '@doudizhu/types';
import { useState } from 'react';

interface Props {
  isMyTurn:        boolean;
  selectedCards:   Card[];
  lastPlay:        ParsedPlay | null;
  canPlaySelected: boolean;
  onPlay:          () => void;
  onPass:          () => void;
  onHint:          () => void;
  onDisputeVote:   () => void;
}

export function ActionBar({
  isMyTurn, selectedCards, lastPlay, canPlaySelected,
  onPlay, onPass, onHint, onDisputeVote,
}: Props) {
  const [showDispute, setShowDispute] = useState(false);
  const [showDisputeConfirm, setShowDisputeConfirm] = useState(false);

  const hasSelected = selectedCards.length > 0;
  const canPass    = lastPlay !== null && lastPlay.cards.length > 0;

  const playLabel = !hasSelected ? '选择牌' : canPlaySelected ? '出牌' : '压不过';
  const playDisabled = !isMyTurn || !hasSelected || !canPlaySelected;

  return (
    <div className="flex items-center justify-center gap-2 px-2 py-2.5">
      {/* 提示按钮 */}
      <button
        onClick={onHint}
        disabled={!isMyTurn}
        className="glass-panel flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm text-green-300/80 transition-all hover:border-green-400/40 hover:text-green-300 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        提示
      </button>

      {/* 过牌按钮 */}
      <button
        onClick={onPass}
        disabled={!isMyTurn || !canPass}
        className="glass-panel flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm text-green-300/80 transition-all hover:border-green-400/40 hover:text-green-300 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        过牌
      </button>

      {/* 出牌按钮 */}
      <button
        onClick={onPlay}
        disabled={playDisabled}
        className={[
          'flex items-center gap-2 rounded-xl px-7 py-2.5 text-base font-bold shadow-lg transition-all active:scale-95',
          playDisabled
            ? hasSelected && !canPlaySelected
              ? 'bg-red-500/20 text-red-400/60 cursor-not-allowed'
              : 'glass-panel text-green-300/30 cursor-not-allowed'
            : 'bg-gradient-to-r from-green-400 to-emerald-400 text-[#0f1f17] shadow-green-500/30 hover:shadow-green-500/40 hover:brightness-110',
        ].join(' ')}
      >
        {canPlaySelected && isMyTurn && hasSelected ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : null}
        {playLabel}
        {hasSelected && <span className="text-xs opacity-70">({selectedCards.length})</span>}
      </button>

      {/* 更多选项 */}
      <div className="relative">
        <button
          onClick={() => setShowDispute(s => !s)}
          className="glass-panel flex items-center justify-center rounded-xl border border-[var(--card-border)] px-3 py-2.5 text-green-300/50 transition-all hover:border-amber-400/30 hover:text-amber-400 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
        {showDispute && (
          <div className="absolute bottom-full right-0 mb-2 animate-float-up rounded-xl border border-amber-500/30 bg-[var(--card-bg)]/95 p-3 shadow-xl backdrop-blur-sm">
            <p className="mb-2 text-[11px] text-green-300/50">遇到结算异常？</p>
            <button
              onClick={() => { setShowDispute(false); setShowDisputeConfirm(true); }}
              className="whitespace-nowrap rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 transition-all hover:bg-amber-500/20 active:scale-95"
            >
              申请争议投票
            </button>
          </div>
        )}
      </div>

      {/* Dispute confirm modal */}
      {showDisputeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="glass-panel animate-badge-pop mx-4 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <h3 className="font-semibold text-amber-400">确认发起争议投票？</h3>
            </div>
            <p className="mb-5 text-xs text-green-300/60 leading-relaxed">
              三人中两人投票即可触发链上争议结算，资金将按链上逻辑退还。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDisputeConfirm(false)}
                className="flex-1 rounded-xl border border-[var(--card-border)] py-2.5 text-sm text-green-300/70 transition-all hover:border-green-400/40 hover:text-green-300 active:scale-95">
                取消
              </button>
              <button
                onClick={() => { setShowDisputeConfirm(false); onDisputeVote(); }}
                className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 py-2.5 text-sm font-semibold text-[#1a0a00] transition-all hover:shadow-lg hover:shadow-amber-500/20 active:scale-95"
              >
                确认投票
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
