'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreateRoomForm } from '../components/lobby/CreateRoomForm';
import { JoinRoomInput } from '../components/lobby/JoinRoomInput';
import { PROGRAM_ID, EXPLORER_BASE, WS_URL } from '../lib/constants';
import { useGameHistory } from '../hooks/useGameHistory';
import { useRewardPool } from '../hooks/useRewardPool';
import type { GameRecord } from '@doudizhu/types';

// ─── 时间格式化 ──────────────────────────────────────────────────────────

const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

function formatRelativeTime(settledAt: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - settledAt;
  if (diffSec < 60)   return rtf.format(-Math.floor(diffSec),        'second');
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60),   'minute');
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), 'hour');
  if (diffSec < 86400 * 30) return rtf.format(-Math.floor(diffSec / 86400), 'day');
  return new Date(settledAt * 1000).toLocaleDateString('zh-CN');
}

// ─── 历史记录行 ──────────────────────────────────────────────────────────

function HistoryRow({ record, index }: { record: GameRecord; index: number }) {
  const delta = BigInt(record.myDelta);
  const explorerUrl = `${EXPLORER_BASE}/tx/${record.txSignature}?cluster=devnet`;

  return (
    <div
      className="group flex items-center justify-between rounded-xl border border-[rgba(0,0,0,0.03)] bg-[#f0ede7] px-4 py-3 text-sm transition-all duration-200 hover:bg-[#ece9e3]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
          record.isWin
            ? 'bg-[#6d9a80]/10 text-[#6d9a80]'
            : 'bg-red-400/8 text-red-400/70'
        }`}>
          {record.isWin ? 'W' : 'L'}
        </span>
        <span className="text-xs text-[#b0aaa3]">{formatRelativeTime(record.settledAt)}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-[#b8960b]/8 px-1.5 py-0.5 text-[11px] font-medium text-[#b8960b]/70">
          x{record.finalMultiplier}
        </span>
        <span className={`font-mono text-xs font-semibold ${record.isWin ? 'text-[#6d9a80]' : 'text-red-400/70'}`}>
          {delta > 0n ? '+' : ''}{delta.toLocaleString()}
        </span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-[#c0bab3] transition hover:text-blue-400/70"
        >
          {record.txSignature.slice(0, 6)}..
        </a>
      </div>
    </div>
  );
}

function RecentHistory() {
  const { records, loading, error } = useGameHistory(5);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#6d9a80]/20 border-t-[#6d9a80]/60" />
      </div>
    );
  }

  if (error) {
    return <p className="py-6 text-center text-xs text-red-400/60">{error}</p>;
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="mb-2 text-2xl opacity-20">&#x1F0CF;</div>
        <p className="text-xs text-[#b0aaa3]">暂无对局记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {records.map((r, i) => <HistoryRow key={r.txSignature} record={r} index={i} />)}
    </div>
  );
}

// ─── 单机练习按钮 ──────────────────────────────────────────────────────────

function SoloPlayButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSolo = useCallback(() => {
    if (loading) return;
    setLoading(true);
    setErr(null);

    const guestId = `guest-${crypto.randomUUID().slice(0, 12)}`;
    const ws = new WebSocket(WS_URL);
    let navigated = false;

    ws.onopen = () => { ws.send(JSON.stringify({ type: 'AUTH', playerId: guestId })); };
    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; roomId?: string; message?: string };
        if (msg.type === 'AUTH_OK') {
          ws.send(JSON.stringify({ type: 'CREATE_SOLO_ROOM' }));
        } else if (msg.type === 'SOLO_ROOM_CREATED' && msg.roomId) {
          navigated = true;
          ws.close();
          router.push(`/game/${msg.roomId}?solo=1&playerId=${encodeURIComponent(guestId)}`);
        } else if (msg.type === 'ERROR') {
          setErr(msg.message ?? '创建失败');
          setLoading(false);
          ws.close();
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { setErr('服务器连接失败'); setLoading(false); };
    ws.onclose = () => { if (!navigated) setLoading(false); };
  }, [router, loading]);

  return (
    <button
      onClick={handleSolo}
      disabled={loading}
      className="group relative w-full overflow-hidden rounded-2xl border border-[#b8960b]/15 bg-gradient-to-br from-[#b8960b]/[0.04] to-transparent p-5 text-left transition-all duration-300 hover:border-[#b8960b]/25 hover:from-[#b8960b]/[0.07] active:scale-[0.98] disabled:opacity-50"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#b8960b]/[0.08] text-lg transition-transform duration-300 group-hover:scale-110">
            &#x1F916;
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#504a44]">单机练习</h3>
            <p className="text-[11px] text-[#b0aaa3]">无需钱包，与 AI 对战</p>
          </div>
        </div>
        <svg className="h-4 w-4 text-[#c0bab3] transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-[#b8960b]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {err && <p className="mt-2 text-xs text-red-400/70">{err}</p>}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#ece7df]/60 backdrop-blur-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#b8960b]/20 border-t-[#b8960b]/60" />
        </div>
      )}
    </button>
  );
}

// ─── 奖励池状态栏 ──────────────────────────────────────────────────────────

function RewardPoolBar() {
  const { data, loading } = useRewardPool();

  if (loading || !data) return null;

  const poolAmount = BigInt(data.currentCycle.poolAmount);
  const progressPct = Math.max(0, Math.min(100, ((7 - data.daysRemaining) / 7) * 100));

  return (
    <div className="animate-float-up mb-8 overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.04)] bg-gradient-to-r from-[#6d9a80]/[0.04] via-[#f4f1ec] to-[#b8960b]/[0.03]">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="relative flex h-11 w-11 items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(0,0,0,0.04)" strokeWidth="2.5" />
              <circle
                cx="22" cy="22" r="18" fill="none" stroke="url(#pool-grad)" strokeWidth="2.5"
                strokeDasharray={`${progressPct * 1.13} 113`}
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="pool-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#6d9a80" />
                  <stop offset="100%" stopColor="#b8960b" />
                </linearGradient>
              </defs>
            </svg>
            <span className="relative text-lg">&#x1F3C6;</span>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#b0aaa3]">奖励池</p>
            <p className="text-lg font-bold tracking-tight text-[#504a44]">
              {poolAmount.toLocaleString()}{' '}
              <span className="text-sm font-normal text-[#b8960b]/70">MEME</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[11px] text-[#b0aaa3]">周期剩余</p>
            <p className="text-base font-bold tabular-nums text-[#6a645e]">
              {data.daysRemaining}<span className="ml-0.5 text-xs font-normal text-[#b0aaa3]">天</span>
            </p>
          </div>
        </div>
      </div>
      <div className="h-[2px] bg-[rgba(0,0,0,0.03)]">
        <div
          className="h-full bg-gradient-to-r from-[#6d9a80]/50 to-[#b8960b]/30 transition-all duration-700"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

// ─── 统计卡片 ──────────────────────────────────────────────────────────────

function StatsBar() {
  const { records } = useGameHistory(20);
  const { data } = useRewardPool();

  const totalGames = records.length;
  const wins = records.filter(r => r.isWin).length;
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
  const netPnl = records.reduce((sum, r) => sum + BigInt(r.myDelta), 0n);

  const stats = [
    { label: '对局', value: totalGames.toString(), sub: '近期' },
    { label: '胜率', value: `${winRate}%`, sub: `${wins}/${totalGames}` },
    { label: '盈亏', value: netPnl > 0n ? `+${netPnl.toLocaleString()}` : netPnl.toLocaleString(), sub: 'MEME', color: netPnl > 0n ? 'text-[#6d9a80]' : netPnl < 0n ? 'text-red-400/70' : 'text-[#8a847e]' },
    { label: '排名', value: data?.topPlayers?.[0] ? '#--' : '--', sub: '本周期' },
  ];

  return (
    <div className="mb-6 grid grid-cols-4 gap-2">
      {stats.map((s, i) => (
        <div key={i} className="rounded-xl border border-[rgba(0,0,0,0.03)] bg-[#f4f1ec] px-3 py-3 text-center">
          <p className="text-[10px] font-medium uppercase tracking-wider text-[#b0aaa3]">{s.label}</p>
          <p className={`mt-0.5 text-base font-bold tabular-nums ${s.color ?? 'text-[#6a645e]'}`}>{s.value}</p>
          <p className="text-[10px] text-[#c0bab3]">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Section 标题 ──────────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-base opacity-40">{icon}</span>
      <h2 className="text-sm font-semibold tracking-wide text-[#6a645e]">{title}</h2>
    </div>
  );
}

// ─── 大厅页面 ──────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const programExplorerUrl = `${EXPLORER_BASE}/address/${PROGRAM_ID.toBase58()}?cluster=devnet`;
  const [depositRetryId, setDepositRetryId] = useState<string | undefined>(undefined);
  const [musicOn, setMusicOn] = useState(false);
  const musicRef = useRef<HTMLAudioElement>(null);

  const toggleMusic = useCallback(() => {
    const audio = musicRef.current;
    if (!audio) return;
    if (musicOn) {
      audio.pause();
    } else {
      audio.volume = 0.3;
      audio.play().catch(() => {});
    }
    setMusicOn(!musicOn);
  }, [musicOn]);

  return (
    <div className="lobby-bg min-h-screen">
      {/* 背景装饰 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#6d9a80]/[0.04] blur-[100px]" />
        <div className="absolute -right-32 top-1/3 h-80 w-80 rounded-full bg-[#b8960b]/[0.03] blur-[80px]" />
        <div className="absolute bottom-0 left-1/2 h-64 w-[600px] -translate-x-1/2 rounded-full bg-[#6d9a80]/[0.03] blur-[100px]" />
      </div>

      <audio ref={musicRef} src="/bgm.mp3" loop preload="auto" />

      <div className="relative mx-auto max-w-5xl px-4 py-6" style={{ minHeight: 'calc(100vh - 56px)' }}>
        {/* 排行榜入口 */}
        <div className="mb-6 flex justify-end">
          <Link
            href="/leaderboard"
            className="group flex items-center gap-2 rounded-xl border border-[rgba(0,0,0,0.04)] bg-[#f4f1ec] px-4 py-2.5 text-sm font-medium text-[#8a847e] transition-all duration-200 hover:border-[#b8960b]/20 hover:text-[#b8960b]/70"
          >
            <span className="opacity-70">&#x1F3C6;</span>
            排行榜
            <svg className="h-3.5 w-3.5 text-[#c0bab3] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#b8960b]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* 奖励池 */}
        <RewardPoolBar />

        {/* 统计卡片 */}
        <StatsBar />

        {/* 主体双列 */}
        <div className="flex flex-col gap-5 lg:flex-row">

          {/* 左列：创建房间 */}
          <div className="lg:w-[58%]">
            <div className="card p-6">
              <SectionHeader title="创建新房间" icon="&#x1F0A1;" />
              <CreateRoomForm onDepositFailed={setDepositRetryId} />
            </div>
          </div>

          {/* 右列 */}
          <div className="flex flex-col gap-4 lg:w-[42%]">
            {/* 快速操作 */}
            <SoloPlayButton />

            {/* 加入房间 */}
            <div className="card p-5">
              <SectionHeader title="加入房间" icon="&#x1F517;" />
              <JoinRoomInput defaultRoomId={depositRetryId} />
            </div>

            {/* 历史 */}
            <div className="card p-5">
              <SectionHeader title="近期对局" icon="&#x1F4CA;" />
              <RecentHistory />
            </div>
          </div>
        </div>

        {/* 音乐开关 */}
        <button
          onClick={toggleMusic}
          className="fixed bottom-5 right-5 flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(0,0,0,0.04)] bg-[#f4f1ec] text-sm text-[#b0aaa3] transition-all duration-200 hover:text-[#8a847e] active:scale-90"
          title={musicOn ? '关闭音乐' : '播放音乐'}
        >
          {musicOn ? '\u266B' : '\u266A'}
        </button>

        {/* Footer */}
        <footer className="mt-12 border-t border-[rgba(0,0,0,0.04)] pb-6 pt-6 text-center">
          <p className="text-[11px] text-[#b0aaa3]">
            合约{' '}
            <a
              href={programExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[#8a847e] transition hover:text-[#6d9a80]"
            >
              {PROGRAM_ID.toBase58().slice(0, 8)}...{PROGRAM_ID.toBase58().slice(-4)}
            </a>
            {' '}&middot;{' '}资金由链上智能合约托管
          </p>
        </footer>
      </div>
    </div>
  );
}
