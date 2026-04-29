'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SERVER_URL } from '../../lib/constants';
import type { LeaderboardEntry } from '@doudizhu/types';

const RANK_MEDALS = ['', '\u{1F947}', '\u{1F948}', '\u{1F949}'];

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchLeaderboard() {
      try {
        const res = await fetch(`${SERVER_URL}/api/leaderboard?limit=50`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { entries: LeaderboardEntry[] };
        if (!cancelled) {
          setEntries(json.entries);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    void fetchLeaderboard();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="lobby-bg min-h-screen">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#6d9a80]/[0.04] blur-[100px]" />
        <div className="absolute -right-32 top-1/3 h-80 w-80 rounded-full bg-[#b8960b]/[0.03] blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#504a44]">排行榜</h1>
            <p className="mt-0.5 text-xs text-[#b0aaa3]">本周期评分排名</p>
          </div>
          <Link
            href="/"
            className="group flex items-center gap-1.5 rounded-xl border border-[rgba(0,0,0,0.04)] bg-[#f4f1ec] px-4 py-2 text-xs text-[#8a847e] transition-all duration-200 hover:text-[#6a645e]"
          >
            <svg className="h-3 w-3 transition-transform duration-200 group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </Link>
        </div>

        {/* 权重说明 */}
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-[rgba(0,0,0,0.03)] bg-[#f4f1ec] px-4 py-3">
          {[
            { label: '对局', weight: '40%', color: 'bg-[#6d9a80]' },
            { label: '胜率', weight: '30%', color: 'bg-blue-400' },
            { label: '精彩', weight: '30%', color: 'bg-[#b8960b]' },
          ].map(w => (
            <div key={w.label} className="flex items-center gap-1.5 text-[11px] text-[#8a847e]">
              <span className={`h-1.5 w-1.5 rounded-full ${w.color} opacity-50`} />
              {w.label} {w.weight}
            </div>
          ))}
        </div>

        {/* 表格 */}
        <div className="overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.04)] bg-[#f4f1ec]">
          {/* 表头 */}
          <div className="grid grid-cols-[3rem_1fr_4rem_4rem_4rem_6rem] items-center border-b border-[rgba(0,0,0,0.04)] px-4 py-3 text-[10px] font-medium uppercase tracking-wider text-[#b0aaa3]">
            <div>#</div>
            <div>玩家</div>
            <div className="text-center">对局</div>
            <div className="text-center">胜场</div>
            <div className="text-center">精彩</div>
            <div className="text-right">奖励</div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#6d9a80]/20 border-t-[#6d9a80]/60" />
            </div>
          )}

          {error && (
            <p className="py-12 text-center text-xs text-red-400/60">{error}</p>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="flex flex-col items-center py-16">
              <div className="mb-2 text-3xl opacity-15">&#x1F3C6;</div>
              <p className="text-xs text-[#b0aaa3]">本周期暂无数据</p>
            </div>
          )}

          {entries.map((entry, i) => {
            const reward = BigInt(entry.rewardAmount);
            const isTop3 = entry.rank <= 3;
            const winRate = entry.gamesPlayed > 0
              ? Math.round((entry.gamesWon / entry.gamesPlayed) * 100)
              : 0;

            return (
              <div
                key={entry.wallet}
                className={`grid grid-cols-[3rem_1fr_4rem_4rem_4rem_6rem] items-center border-b border-[rgba(0,0,0,0.02)] px-4 py-3 text-sm transition-all duration-150 hover:bg-[#f0ede7] ${isTop3 ? 'bg-[#b8960b]/[0.03]' : ''}`}
              >
                <div className={`text-xs font-bold ${isTop3 ? 'text-[#b8960b]/70' : 'text-[#c0bab3]'}`}>
                  {RANK_MEDALS[entry.rank] ?? entry.rank}
                </div>
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-[#8a847e]">
                    {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                  </span>
                  {winRate >= 60 && entry.gamesPlayed >= 5 && (
                    <span className="rounded-full bg-[#6d9a80]/10 px-1.5 py-0.5 text-[9px] font-medium text-[#6d9a80]">
                      {winRate}%
                    </span>
                  )}
                </div>
                <div className="text-center text-xs tabular-nums text-[#8a847e]">{entry.gamesPlayed}</div>
                <div className="text-center text-xs tabular-nums text-[#8a847e]">{entry.gamesWon}</div>
                <div className={`text-center text-xs tabular-nums ${entry.highlights > 0 ? 'text-[#b8960b]/70' : 'text-[#c0bab3]'}`}>
                  {entry.highlights}
                </div>
                <div className="text-right font-mono text-xs tabular-nums text-[#6d9a80]">
                  {reward > 0n ? reward.toLocaleString() : '-'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
