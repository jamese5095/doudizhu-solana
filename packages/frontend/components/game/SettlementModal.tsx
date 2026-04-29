'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { WireSettleResult } from '../../hooks/useGameState';
import { EXPLORER_BASE } from '../../lib/constants';

interface Props {
  gameOver:         boolean;
  settlementResult: WireSettleResult | null;
  settlementFailed: boolean;
  myPlayerId:       string | null;
  onDisputeVote:    () => void;
}

function parseDelta(v: number | string | undefined): bigint {
  if (v === undefined) return 0n;
  try { return BigInt(v); } catch { return 0n; }
}

export function SettlementModal({ gameOver, settlementResult, settlementFailed, myPlayerId, onDisputeVote }: Props) {
  const router = useRouter();

  // ── 所有 hooks 必须放在条件 return 之前 ───────────────────────────────

  const myPayout   = settlementResult?.payouts.find(p => p.playerId === myPlayerId);
  const myDelta    = parseDelta(myPayout?.delta);
  const iWon       = myDelta > 0n;
  const isSolo     = settlementResult?.isSolo === true;

  useEffect(() => {
    if (!settlementResult) return;
    const audio = new Audio(iWon ? '/win.mp3' : '/lose.mp3');
    audio.volume = 0.8;
    audio.play().catch(() => {});
    return () => { audio.pause(); };
  }, [iWon, settlementResult]);

  // ── 条件 return ───────────────────────────────────────────────────────

  if (!gameOver) return null;

  if (!settlementResult && !settlementFailed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="glass-panel animate-badge-pop flex flex-col items-center gap-5 rounded-2xl p-10 shadow-2xl">
          <div className="relative">
            <div className="h-14 w-14 animate-spin rounded-full border-4 border-green-400/20 border-t-transparent" />
            <div className="absolute inset-0 animate-pulse rounded-full border-2 border-green-400/10" />
          </div>
          <p className="text-base font-medium text-green-300">结算确认中，请稍候...</p>
          <p className="text-xs text-green-300/40">区块链确认通常需要几秒</p>
        </div>
      </div>
    );
  }

  if (settlementFailed && !settlementResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="glass-panel animate-badge-pop mx-4 w-full max-w-sm rounded-2xl border border-red-500/30 p-8 shadow-2xl">
          <div className="mb-4 flex flex-col items-center gap-2 text-center">
            <span className="text-4xl">⚠️</span>
            <p className="text-xl font-bold text-red-400">结算异常</p>
            <p className="text-xs text-green-300/50">您的资金安全，请联系客服或发起争议投票</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onDisputeVote}
              className="flex-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-400 transition-all hover:bg-amber-500/20 active:scale-95">
              争议投票
            </button>
            <button onClick={() => router.push('/')}
              className="flex-1 rounded-xl bg-green-400 py-2.5 text-sm font-semibold text-[#0f1f17] transition-all hover:bg-green-300 active:scale-95">
              返回大厅
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!settlementResult) return null;

  const explorerUrl = `${EXPLORER_BASE}/tx/${settlementResult.txSignature}?cluster=devnet`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className={`glass-panel animate-badge-pop mx-4 w-full max-w-sm rounded-2xl border p-8 shadow-2xl ${
        iWon
          ? 'border-amber-400/30 shadow-amber-500/10'
          : 'border-[var(--card-border)]'
      }`}>

        {/* 结算标题 */}
        <div className="mb-4 flex flex-col items-center gap-1 text-center">
          <span className="text-4xl">{iWon ? '🏆' : '💔'}</span>
          <p className={`text-3xl font-black ${iWon ? 'text-gold-gradient' : 'text-red-400'}`}>
            {iWon ? '胜 利 ！' : '失 败'}
          </p>
          {!isSolo && (
            <p className={`font-mono text-3xl font-bold ${iWon ? 'text-green-400' : 'text-red-400/80'}`}>
              {myDelta > 0n ? '+' : ''}{myDelta.toLocaleString()}
              <span className="ml-1 text-sm text-green-300/40">MEME</span>
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-0.5 text-xs font-bold text-amber-400">
              ×{settlementResult.finalMultiplier} 倍率
            </span>
            {settlementResult.verified && (
              <span className="rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] text-green-400/70">
                ✓ 链上验证
              </span>
            )}
          </div>
        </div>

        {/* 结算明细 */}
        <div className="mb-5 space-y-1.5">
          <p className="mb-2 text-[10px] text-green-300/30 uppercase tracking-widest">结算明细</p>
          {settlementResult.payouts.map(p => {
            const d = parseDelta(p.delta);
            const isWinner = p.playerId === settlementResult.winnerId;
            const isMe = p.playerId === myPlayerId;
            return (
              <div key={p.playerId} className={[
                'flex items-center justify-between rounded-lg px-3 py-2 transition-all',
                isWinner ? 'border border-amber-400/20 bg-amber-500/5' : 'bg-[#0a1810]/60',
                isMe ? 'ring-1 ring-green-400/20' : '',
              ].join(' ')}>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{isWinner ? '⭐' : '👤'}</span>
                  <span className={`font-mono text-xs ${isMe ? 'text-green-300 font-semibold' : 'text-green-300/60'}`}>
                    {p.playerId.slice(0, 6)}…{p.playerId.slice(-4)}
                  </span>
                  {isMe && <span className="text-[10px] text-green-400/70">(我)</span>}
                  {isWinner && <span className="text-[10px] text-amber-400/70">★</span>}
                </div>
                {!isSolo && (
                  <span className={`font-mono text-sm font-bold ${d > 0n ? 'text-green-400' : 'text-red-400/70'}`}>
                    {d > 0n ? '+' : ''}{d.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 交易链接 */}
        {isSolo ? (
          <p className="mb-5 text-center text-xs text-green-300/30">练习模式 · 无链上记录</p>
        ) : (
          <p className="mb-5 text-center">
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="font-mono text-xs text-blue-400/60 hover:text-blue-400 transition-all underline underline-offset-2">
              {settlementResult.txSignature.slice(0, 16)}...
            </a>
          </p>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          {!isSolo && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 flex-1 rounded-xl border border-blue-400/30 bg-blue-400/10 py-2.5 text-sm text-blue-400 transition-all hover:bg-blue-400/20 active:scale-95">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              查看交易
            </a>
          )}
          <button onClick={() => router.push('/')}
            className={`flex items-center justify-center gap-1.5 flex-1 rounded-xl py-2.5 text-sm font-semibold text-[#0f1f17] transition-all active:scale-95 ${
              iWon
                ? 'bg-gradient-to-r from-amber-400 to-amber-300 hover:shadow-lg hover:shadow-amber-400/20'
                : 'bg-gradient-to-r from-green-400 to-emerald-400 hover:bg-green-300'
            }`}>
            {isSolo ? '返回大厅' : '再来一局'}
          </button>
        </div>
      </div>
    </div>
  );
}
