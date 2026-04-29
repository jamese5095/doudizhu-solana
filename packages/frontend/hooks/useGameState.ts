'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { GameState, ParsedPlay, Card } from '@doudizhu/types';
import { GamePhase } from '@doudizhu/types';
import { useGameSocket, type ConnectionStatus } from './useGameSocket';

export interface BotActionInfo {
  playerId:  string;
  action:    'PLAY' | 'PASS';
  cards:     Card[];
}

// Wire format: delta/fee are numbers or strings (BigInt can't be JSON-serialised)
export interface WirePayoutEntry {
  playerId: string;
  delta:    string;   // bigint serialized as string; parse with BigInt(v)
}
export interface WireSettleResult {
  roomId:          string;
  txSignature:     string;
  winnerId:        string;
  finalMultiplier: number;
  payouts:         WirePayoutEntry[];
  fee:             string;  // bigint serialized as string; parse with BigInt(v)
  verified:        boolean;
  settledAt:       number;
  isSolo?:         boolean;
}

export interface GameStateResult {
  gameState:        GameState | null;
  myCards:          readonly Card[];
  myIndex:          number;
  isMyTurn:         boolean;
  isBidding:        boolean;
  lastPlay:         ParsedPlay | null;
  lastPlayerId:     string | null;
  kittyCards:       readonly Card[];
  phase:            GamePhase;
  gameOver:         boolean;
  settlementResult: WireSettleResult | null;
  settlementFailed: boolean;
  botActionInfo:    BotActionInfo | null;
  error:            string | null;
  timerSeconds:     number;
  connectionStatus: ConnectionStatus;
  clearError:       () => void;
  sendReady:        () => void;
  sendBid:          (bid: boolean) => void;
  sendPlay:         (cards: Card[]) => void;
  sendPass:         () => void;
  sendDisputeVote:  () => void;
}

const TURN_SECONDS = 30;

export function useGameState(roomId: string, playerId: string | null): GameStateResult {
  const [gameState,        setGameState]        = useState<GameState | null>(null);
  const [gameOver,         setGameOver]         = useState(false);
  const [settlementResult, setSettlementResult] = useState<WireSettleResult | null>(null);
  const [settlementFailed, setSettlementFailed] = useState(false);
  const [botActionInfo,    setBotActionInfo]    = useState<BotActionInfo | null>(null);
  const [error,            setError]            = useState<string | null>(null);
  const [timerSeconds,     setTimerSeconds]     = useState(TURN_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((msg: { type: string; [k: string]: unknown }) => {
    switch (msg.type) {
      case 'ROOM_JOINED':
        setGameState((msg.state ?? null) as GameState | null);
        break;
      case 'GAME_STATE_UPDATE':
        setGameState((msg.state ?? null) as GameState | null);
        break;
      case 'GAME_OVER':
        setGameOver(true);
        break;
      case 'SETTLEMENT_CONFIRMED':
        setSettlementResult(msg as unknown as WireSettleResult);
        break;
      case 'SETTLEMENT_FAILED':
        setSettlementFailed(true);
        setError((msg.message as string) ?? '结算异常');
        break;
      case 'BOT_ACTION':
        setBotActionInfo({
          playerId: msg.playerId as string,
          action:   msg.action   as 'PLAY' | 'PASS',
          cards:    (msg.cards   as Card[]) ?? [],
        });
        if (botToastRef.current) clearTimeout(botToastRef.current);
        botToastRef.current = setTimeout(() => setBotActionInfo(null), 3_000);
        break;
      case 'ERROR':
        setError(msg.message as string);
        break;
    }
  }, []);

  const { connectionStatus, sendReady, sendBid, sendPlay, sendPass, sendDisputeVote } =
    useGameSocket({ roomId, playerId, onMessage: handleMessage });

  // Derive derived state
  const myIndex = playerId && gameState
    ? gameState.players.findIndex(p => p.playerId === playerId)
    : -1;

  const myCards: readonly Card[] = myIndex >= 0 && gameState
    ? gameState.players[myIndex].handCards
    : [];

  const phase = gameState?.phase ?? GamePhase.WaitingToStart;

  const isMyTurn = myIndex >= 0 && gameState !== null
    && gameState.currentTurnIndex === myIndex
    && phase === GamePhase.Playing;

  const isBidding = myIndex >= 0 && gameState !== null
    && gameState.currentTurnIndex === myIndex
    && phase === GamePhase.Bidding;

  // Local turn countdown — reset whenever isMyTurn becomes true
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isMyTurn && !isBidding) { setTimerSeconds(TURN_SECONDS); return; }
    setTimerSeconds(TURN_SECONDS);
    timerRef.current = setInterval(() => {
      setTimerSeconds(s => {
        if (s <= 1) { clearInterval(timerRef.current!); return 0; }
        return s - 1;
      });
    }, 1_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isMyTurn, isBidding, gameState?.currentTurnIndex]);

  useEffect(() => () => { if (botToastRef.current) clearTimeout(botToastRef.current); }, []);

  return {
    gameState,
    myCards,
    myIndex,
    isMyTurn,
    isBidding,
    lastPlay:         gameState?.lastPlay         ?? null,
    lastPlayerId:     gameState?.lastPlayerId     ?? null,
    kittyCards:       gameState?.kitty            ?? [],
    phase,
    gameOver,
    settlementResult,
    settlementFailed,
    botActionInfo,
    error,
    timerSeconds,
    connectionStatus,
    clearError:       () => setError(null),
    sendReady,
    sendBid,
    sendPlay,
    sendPass,
    sendDisputeVote,
  };
}
