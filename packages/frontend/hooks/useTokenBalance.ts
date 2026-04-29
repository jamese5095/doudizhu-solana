'use client';

import { useEffect, useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { MINT, TOKEN_PROGRAM_ID } from '../lib/constants';

export interface TokenBalanceResult {
  balance: bigint;
  loading: boolean;
  error:   string | null;
  refresh: () => void;
}

export function useTokenBalance(): TokenBalanceResult {
  const { connection }      = useConnection();
  const { publicKey }       = useWallet();
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!publicKey) {
      setBalance(0n);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ata = getAssociatedTokenAddressSync(MINT, publicKey, false, TOKEN_PROGRAM_ID);
      const acct = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID);
      setBalance(acct.amount);
    } catch {
      // ATA does not exist → balance is 0
      setBalance(0n);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void fetch();
    const id = setInterval(() => { void fetch(); }, 10_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { balance, loading, error, refresh: fetch };
}
