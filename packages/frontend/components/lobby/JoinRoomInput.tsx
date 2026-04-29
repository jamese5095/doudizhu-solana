'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { TxStatus } from '../shared/TxStatus';
import { useRoomActions } from '../../hooks/useRoomActions';

const ROOM_ID_RE = /^[0-9a-f]{32}$/i;

interface RoomInfo {
  players: string[];
}

async function fetchRoom(roomId: string): Promise<RoomInfo | null> {
  try {
    const res = await fetch(`/api/room/${roomId}`);
    if (!res.ok) return null;
    return (await res.json()) as RoomInfo;
  } catch {
    return null;
  }
}

interface Props {
  defaultRoomId?: string;
}

export function JoinRoomInput({ defaultRoomId }: Props) {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { joinAndDeposit, txState, resetTx } = useRoomActions();

  const [roomId, setRoomId]  = useState(defaultRoomId ?? '');
  const [error, setError]    = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    setError('');
    const id = roomId.trim().toLowerCase();

    if (!ROOM_ID_RE.test(id)) {
      setError('房间 ID 格式无效（需为 32 位十六进制字符串）');
      return;
    }
    if (!publicKey) {
      setError('请先连接钱包');
      return;
    }

    setLoading(true);
    try {
      const room = await fetchRoom(id);
      if (!room) {
        setError('房间不存在或已过期');
        return;
      }
      const walletAddr = publicKey.toBase58();
      if (!room.players.includes(walletAddr)) {
        setError('你不在此房间的玩家列表中');
        return;
      }

      await joinAndDeposit(id);
      router.push(`/game/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加入失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <input
          type="text"
          value={roomId}
          onChange={e => { setRoomId(e.target.value); setError(''); resetTx(); }}
          placeholder="粘贴 32 位十六进制房间 ID"
          maxLength={32}
          className="w-full rounded-xl border border-[rgba(0,0,0,0.05)] bg-[#f0ede7] px-3.5 py-2.5 font-mono text-xs text-[#504a44] placeholder-[#c0bab3] transition-all duration-200"
        />
        {error && <p className="text-[11px] text-red-400/80">{error}</p>}
      </div>

      <button
        onClick={() => void handleJoin()}
        disabled={loading || !publicKey}
        className="w-full rounded-xl border border-[#6d9a80]/20 bg-[#6d9a80]/[0.06] py-2.5 text-sm font-medium text-[#6d9a80] transition-all duration-200 hover:border-[#6d9a80]/30 hover:bg-[#6d9a80]/[0.1] disabled:opacity-35 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {loading ? '验证中...' : '加入房间'}
      </button>

      <TxStatus txState={txState} onRetry={resetTx} />
    </div>
  );
}
