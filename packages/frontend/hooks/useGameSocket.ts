'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Card } from '@doudizhu/types';
import { WS_URL } from '../lib/constants';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ServerMsg {
  type: string;
  [key: string]: unknown;
}

interface Options {
  roomId: string;
  playerId: string | null;
  onMessage: (msg: ServerMsg) => void;
}

export function useGameSocket({ roomId, playerId, onMessage }: Options) {
  const wsRef            = useRef<WebSocket | null>(null);
  const retriesRef       = useRef(0);
  const reconnTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef     = useRef(onMessage);
  onMessageRef.current   = onMessage;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  const connect = useCallback(() => {
    if (!playerId) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setConnectionStatus('connecting');

    ws.onopen = () => {
      retriesRef.current = 0;
      setConnectionStatus('connected');
      ws.send(JSON.stringify({ type: 'AUTH', playerId }));
    };

    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as ServerMsg;
        // After AUTH_OK, immediately join the room
        if (msg.type === 'AUTH_OK') {
          ws.send(JSON.stringify({ type: 'JOIN_ROOM', roomId }));
        }
        onMessageRef.current(msg);
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      if (retriesRef.current < 5) {
        retriesRef.current += 1;
        reconnTimerRef.current = setTimeout(connect, 2_000);
      }
    };

    ws.onerror = () => { ws.close(); };
  }, [playerId, roomId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendRaw = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return {
    connectionStatus,
    sendReady:        () => sendRaw({ type: 'READY' }),
    sendBid:          (bid: boolean) => sendRaw({ type: 'BID', bid }),
    sendPlay:         (cards: Card[]) => sendRaw({ type: 'PLAY_CARDS', cards }),
    sendPass:         () => sendRaw({ type: 'PASS' }),
    sendDisputeVote:  () => sendRaw({ type: 'DISPUTE_VOTE' }),
  };
}
