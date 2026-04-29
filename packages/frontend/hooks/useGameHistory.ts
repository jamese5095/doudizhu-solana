'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { SERVER_URL } from '../lib/constants';
import type { GameRecord } from '@doudizhu/types';

export interface UseGameHistoryResult {
  records:  GameRecord[];
  loading:  boolean;
  error:    string | null;
  refetch:  () => void;
}

export function useGameHistory(limit = 5): UseGameHistoryResult {
  const { publicKey } = useWallet();
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!publicKey) {
      setRecords([]);
      return;
    }

    setLoading(true);
    setError(null);

    void fetch(`${SERVER_URL}/api/history?wallet=${publicKey.toBase58()}&limit=${limit}`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GameRecord[]>;
      })
      .then(data => setRecords(data))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '获取历史记录失败');
      })
      .finally(() => setLoading(false));
  }, [publicKey, limit]);

  // 钱包连接或切换时自动触发
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { records, loading, error, refetch };
}
