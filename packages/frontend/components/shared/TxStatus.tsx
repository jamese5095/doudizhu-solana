'use client';

import type { TxState } from '../../hooks/useRoomActions';
import { EXPLORER_BASE } from '../../lib/constants';

interface Props {
  txState: TxState;
  onRetry?: () => void;
}

export function TxStatus({ txState, onRetry }: Props) {
  if (txState.status === 'idle') return null;

  if (txState.status === 'sending') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        交易广播中，请稍候...
      </div>
    );
  }

  if (txState.status === 'confirmed' && txState.signature) {
    const explorerUrl = `${EXPLORER_BASE}/tx/${txState.signature}?cluster=devnet`;
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
        <span className="text-green-400">✓</span>
        交易已确认&nbsp;
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-blue-400 underline underline-offset-2 hover:text-blue-300"
        >
          {txState.signature.slice(0, 8)}...
        </a>
      </div>
    );
  }

  if (txState.status === 'error') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        <span>✗ 交易失败：{txState.error}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded border border-red-500/50 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20"
          >
            重试
          </button>
        )}
      </div>
    );
  }

  return null;
}
