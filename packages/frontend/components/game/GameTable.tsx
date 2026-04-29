'use client';

import { useMemo, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Card } from '@doudizhu/types';
import { GamePhase } from '@doudizhu/types';
import { useGameState } from '../../hooks/useGameState';
import { useCardSelection } from '../../hooks/useCardSelection';
import { MyHand }          from './MyHand';
import { OpponentArea }    from './OpponentArea';
import { ActionBar }       from './ActionBar';
import { TimerRing }       from './TimerRing';
import { MultiplierBadge } from './MultiplierBadge';
import { KittyCards }      from './KittyCards';
import { BidPanel }        from './BidPanel';
import { SettlementModal } from './SettlementModal';
import { BotActionToast }  from './BotActionToast';
import { CardView }        from './CardView';
import { useBgm }          from '../../hooks/useBgm';
import { CardPattern }     from '@doudizhu/types';

function cardKey(c: Card) { return `${c.suit}_${c.rank}`; }

const PATTERN_NAMES: Partial<Record<CardPattern, string>> = {
  [CardPattern.Single]:            '单张',
  [CardPattern.Pair]:              '对子',
  [CardPattern.Triple]:            '三张',
  [CardPattern.TripleWithOne]:    '三带一',
  [CardPattern.TripleWithPair]:    '三带二',
  [CardPattern.Straight]:          '顺子',
  [CardPattern.ConsecutivePairs]:   '连对',
  [CardPattern.Airplane]:          '飞机',
  [CardPattern.AirplaneWithWings]: '飞机带翅',
  [CardPattern.FourWithTwo]:       '四带二',
  [CardPattern.Bomb]:             '💣炸弹',
  [CardPattern.Rocket]:           '🚀火箭',
};

interface Props {
  roomId:   string;
  playerId: string | null;
}

export function GameTable({ roomId, playerId }: Props) {
  const gs  = useGameState(roomId, playerId);
  const sel = useCardSelection(gs.myCards);

  const { setMuted } = useBgm(gs.phase);
  const [muted, setMutedLocal] = useState(false);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMutedLocal(next);
    setMuted(next);
  }, [muted, setMuted]);

  const rightIndex = gs.myIndex >= 0 ? (gs.myIndex + 1) % 3 : 1;
  const leftIndex  = gs.myIndex >= 0 ? (gs.myIndex + 2) % 3 : 2;

  const rightPlayer = gs.gameState?.players[rightIndex] ?? null;
  const leftPlayer  = gs.gameState?.players[leftIndex]  ?? null;

  // 练习模式下区分 bot1 / bot2
  const isSolo     = !!playerId?.startsWith('guest-');
  const bot1Suffix = `-${roomId.slice(0, 8)}-1`;
  const bot2Suffix = `-${roomId.slice(0, 8)}-2`;
  const getBotName = (addr: string) => {
    if (addr.endsWith(bot1Suffix)) return '机器人①';
    if (addr.endsWith(bot2Suffix)) return '机器人②';
    return undefined;
  };
  const rightDisplay = rightPlayer ? (isSolo ? getBotName(rightPlayer.playerId) : undefined) : undefined;
  const leftDisplay  = leftPlayer  ? (isSolo ? getBotName(leftPlayer.playerId)  : undefined) : undefined;

  const selectedKeySet = useMemo(
    () => new Set(sel.selectedCards.map(cardKey)),
    [sel.selectedCards],
  );

  const router = useRouter();

  const handlePlay = useCallback(() => {
    if (!sel.canPlaySelected(gs.lastPlay)) return;
    gs.sendPlay([...sel.selectedCards]);
    sel.clearSelection();
  }, [gs, sel]);

  const handleHint = useCallback(() => {
    const hint = sel.getHint(gs.lastPlay);
    sel.clearSelection();
    hint.forEach(c => sel.toggleCard(c));
  }, [gs.lastPlay, sel]);

  // ── 断线提示 ─────────────────────────────────────────────────────────────
  if (gs.connectionStatus === 'disconnected' && !gs.gameState) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <div className="glass-panel rounded-2xl px-8 py-6 text-center">
          <p className="mb-1 text-lg font-semibold text-red-400">连接已断开</p>
          <p className="mb-4 text-sm text-green-300/60">请检查网络后刷新页面</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-green-400 px-6 py-2 text-sm font-semibold text-[#0f1f17] hover:bg-green-300 active:scale-95"
          >
            刷新重连
          </button>
        </div>
      </div>
    );
  }

  // ── 等待开始 ─────────────────────────────────────────────────────────────
  if (!gs.gameState || gs.phase === GamePhase.WaitingToStart) {
    return (
      <div data-phase="waiting" className="flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center gap-6">
        {/* 房间号标签 */}
        <div className="animate-badge-pop glass-panel rounded-full px-5 py-2">
          <span className="font-mono text-sm text-green-300/70">房间 </span>
          <span className="font-mono text-sm font-bold text-green-300">{roomId.slice(0, 8)}</span>
        </div>

        {/* 玩家槽位指示 */}
        <div className="flex items-center gap-3">
          {[0, 1, 2].map(i => {
            const p = gs.gameState?.players[i];
            return (
              <div key={i} className={[
                'flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm transition-all',
                p
                  ? 'border-green-400 bg-green-400/15 text-green-400'
                  : 'border-[var(--card-border)] bg-[var(--card-bg)] text-green-300/30',
              ].join(' ')}>
                {p ? '👤' : '?'}
              </div>
            );
          })}
        </div>

        <p className="text-lg font-medium text-green-300/70">等待玩家准备...</p>

        {gs.connectionStatus === 'connected' && (
          <button
            onClick={gs.sendReady}
            className="btn-glow rounded-xl bg-gradient-to-r from-green-400 to-emerald-400 px-12 py-3.5 text-lg font-bold text-[#0f1f17] shadow-lg shadow-green-500/30 transition hover:shadow-green-500/40 hover:brightness-110 active:scale-95"
          >
            我准备好了
          </button>
        )}
        {gs.connectionStatus === 'connecting' && (
          <div className="flex items-center gap-2 text-sm text-green-300/60">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-400 border-t-transparent" />
            连接中...
          </div>
        )}
        <button
          onClick={() => router.push('/')}
          className="rounded-xl border border-[var(--card-border)] px-6 py-2 text-sm text-green-300/50 transition hover:border-green-400/40 hover:text-green-300 active:scale-95"
        >
          退出房间
        </button>
      </div>
    );
  }

  const kittyRevealed = gs.phase === GamePhase.Playing || gs.phase === GamePhase.Ended;

  return (
    <div data-phase={gs.phase} className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden table-felt">

      {/* ══ 顶栏：倍率 · 底牌 · 计时 ════════════════════════════════ */}
      <div className="glass-panel flex flex-shrink-0 items-center justify-between px-4 py-2.5 rounded-none border-x-0 border-t-0">

        {/* 左侧：倍率 */}
        <MultiplierBadge multiplier={gs.gameState.multiplier} />

        {/* 中间：底牌 */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] text-green-300/40 tracking-widest">底牌</span>
          <KittyCards cards={gs.kittyCards} revealed={kittyRevealed} />
          {gs.connectionStatus === 'disconnected' && (
            <span className="text-[9px] text-red-400 animate-pulse">重连中</span>
          )}
        </div>

        {/* 右侧：计时器 + 静音 */}
        <div className="flex items-center gap-2">
          {(gs.isMyTurn || gs.isBidding) && <TimerRing seconds={gs.timerSeconds} />}
          <button
            onClick={toggleMute}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--card-border)] text-sm transition hover:border-green-400/40 hover:text-green-300 active:scale-95"
            title={muted ? '开启音乐' : '关闭音乐'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* ══ 主区：左对手 ｜ 桌面中央 ｜ 右对手 ══════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── 左侧对手 ── */}
        <div className="flex w-28 flex-shrink-0 flex-col md:w-36 relative">
          <div className="absolute inset-0 border-r border-green-400/10" />
          {leftPlayer && (
            <OpponentArea
              player={leftPlayer}
              isCurrentTurn={gs.gameState.currentTurnIndex === leftIndex}
              layout="left"
              displayName={leftDisplay}
            />
          )}
        </div>

        {/* ── 桌面中央 ── */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 overflow-hidden">

          {/* 叫地主阶段 */}
          {gs.phase === GamePhase.Bidding && gs.isBidding && (
            <div className="animate-float-up">
              <BidPanel onBid={gs.sendBid} disabled={false} />
            </div>
          )}
          {gs.phase === GamePhase.Bidding && !gs.isBidding && (
            <p className="text-sm text-green-300/40">等待叫牌...</p>
          )}

          {/* 出牌阶段：桌面牌型区 */}
          {gs.phase === GamePhase.Playing && (
            <div className="flex w-full flex-col items-center gap-3">

              {/* ── 当前控制牌型 ── */}
              {gs.lastPlay && gs.lastPlay.cards.length > 0 ? (
                <div className="animate-float-up glass-panel flex flex-col items-center gap-2 rounded-2xl border border-green-400/20 px-6 py-4">
                  {/* 出牌方 + 牌型名称 */}
                  <div className="flex items-center gap-3">
                    <div className={[
                      'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
                      gs.lastPlayerId === playerId
                        ? 'bg-green-400/20 text-green-300'
                        : 'bg-[var(--card-bg)] text-green-300/50',
                    ].join(' ')}>
                      {gs.lastPlayerId === playerId ? '我' : '👤'}
                    </div>
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-400 shadow-inner shadow-amber-500/10">
                      {PATTERN_NAMES[gs.lastPlay.pattern] ?? gs.lastPlay.pattern}
                    </span>
                  </div>
                  {/* 牌面：flex-wrap 保证任意张数都不溢出 */}
                  <div className="flex max-w-[180px] flex-wrap justify-center gap-1">
                    {gs.lastPlay.cards.map((c, i) => (
                      <CardView key={i} card={c} size="md" />
                    ))}
                  </div>
                </div>
              ) : (
                /* 桌面空白时的装饰文字 */
                <div className="relative flex flex-col items-center gap-1">
                  <span className="select-none text-4xl font-black text-green-400/5 tracking-widest">斗</span>
                  <span className="text-[10px] text-green-300/20">等待出牌</span>
                </div>
              )}

              {/* ── 轮到我出牌提示 ── */}
              {gs.isMyTurn && (
                <div className="animate-bounce rounded-full border border-green-400/50 bg-green-400/15 px-6 py-2 text-sm font-bold tracking-wide text-green-300 shadow-lg shadow-green-400/10">
                  ✦ 轮到你出牌
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 右侧对手 ── */}
        <div className="flex w-28 flex-shrink-0 flex-col md:w-36 relative">
          <div className="absolute inset-0 border-l border-green-400/10" />
          {rightPlayer && (
            <OpponentArea
              player={rightPlayer}
              isCurrentTurn={gs.gameState.currentTurnIndex === rightIndex}
              layout="right"
              displayName={rightDisplay}
            />
          )}
        </div>
      </div>

      {/* ══ 错误提示 ══════════════════════════════════════════════════ */}
      {gs.error && (
        <div className="mx-4 mb-1 flex flex-shrink-0 items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400 animate-float-up">
          <span>{gs.error}</span>
          <button onClick={gs.clearError} className="ml-2 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ══ 我的手牌 + 操作栏 ════════════════════════════════════════ */}
      <div className="flex-shrink-0 border-t border-green-400/10">
        <MyHand
          cards={gs.myCards}
          selectedKeys={selectedKeySet}
          isMyTurn={gs.isMyTurn}
          isBidding={gs.phase === GamePhase.Bidding}
          onToggle={sel.toggleCard}
        />

        {gs.phase === GamePhase.Playing && (
          <ActionBar
            isMyTurn={gs.isMyTurn}
            selectedCards={sel.selectedCards}
            lastPlay={gs.lastPlay}
            canPlaySelected={sel.canPlaySelected(gs.lastPlay)}
            onPlay={handlePlay}
            onPass={gs.sendPass}
            onHint={handleHint}
            onDisputeVote={gs.sendDisputeVote}
          />
        )}
      </div>

      {/* ══ 浮层 ════════════════════════════════════════════════════ */}
      <BotActionToast info={gs.botActionInfo} roomId={roomId} />

      <SettlementModal
        gameOver={gs.gameOver}
        settlementResult={gs.settlementResult}
        settlementFailed={gs.settlementFailed}
        myPlayerId={playerId}
        onDisputeVote={gs.sendDisputeVote}
      />
    </div>
  );
}
