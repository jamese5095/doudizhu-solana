'use client';

import { useState, useEffect } from 'react';
import { SERVER_URL } from '../lib/constants';
import type { RewardCycle, LeaderboardEntry } from '@doudizhu/types';

interface RewardPoolData {
  currentCycle: RewardCycle;
  daysRemaining: number;
  topPlayers: LeaderboardEntry[];
}

export function useRewardPool() {
  const [data, setData] = useState<RewardPoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPool() {
      try {
        const res = await fetch(`${SERVER_URL}/api/reward-pool`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as RewardPoolData;
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    void fetchPool();
    // 每 60 秒刷新
    const interval = setInterval(() => void fetchPool(), 60_000);

    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { data, loading, error };
}
