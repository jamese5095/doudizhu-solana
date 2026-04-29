'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BetTierSelector } from './BetTierSelector';
import { TxStatus } from '../shared/TxStatus';
import { useRoomActions, RoomCreatedDepositFailed } from '../../hooks/useRoomActions';
import { useTokenBalance } from '../../hooks/useTokenBalance';
import { BET_TIERS } from '../../lib/betTiers';

function isValidPubkey(s: string): boolean {
  try {
    const pk = new PublicKey(s);
    return PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}

interface Props {
  onDepositFailed?: (roomId: string) => void;
}

export function CreateRoomForm({ onDepositFailed }: Props) {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { balance }   = useTokenBalance();
  const { createRoom, txState, resetTx } = useRoomActions();

  const [tier, setTier]       = useState<number | null>(null);
  const [addr2, setAddr2]     = useState('');
  const [addr3, setAddr3]     = useState('');
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm]       = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [depositRetryId, setDepositRetryId] = useState<string | null>(null);

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (tier === null) e.tier = '请选择押注档位';
    if (!addr2) {
      e.addr2 = '请输入玩家 2 地址';
    } else if (!isValidPubkey(addr2)) {
      e.addr2 = '地址格式无效（需为 base58 公钥）';
    }
    if (!addr3) {
      e.addr3 = '请输入玩家 3 地址';
    } else if (!isValidPubkey(addr3)) {
      e.addr3 = '地址格式无效（需为 base58 公钥）';
    }
    if (addr2 && addr3 && addr2 === addr3) {
      e.addr3 = '玩家 2 和玩家 3 地址不能相同';
    }
    if (publicKey && addr2 === publicKey.toBase58()) e.addr2 = '不能填入自己的地址';
    if (publicKey && addr3 === publicKey.toBase58()) e.addr3 = '不能填入自己的地址';
    if (tier !== null) {
      const needed = BET_TIERS[tier]?.amount ?? 0n;
      if (balance < needed) e.balance = '代币余额不足以支付所选档位押注';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [tier, addr2, addr3, publicKey, balance]);

  const handleSubmit = () => {
    if (!validate()) return;
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    if (!publicKey || tier === null) return;
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const { roomId } = await createRoom(
        [publicKey, new PublicKey(addr2), new PublicKey(addr3)],
        tier,
      );
      router.push(`/game/${roomId}`);
    } catch (err) {
      if (err instanceof RoomCreatedDepositFailed) {
        setDepositRetryId(err.roomId);
        onDepositFailed?.(err.roomId);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-[rgba(0,0,0,0.04)] bg-[#f0ede7] py-12 text-center">
        <div className="mb-3 text-3xl opacity-20">&#x1F512;</div>
        <p className="text-sm text-[#b0aaa3]">请先连接钱包</p>
      </div>
    );
  }

  const tierAmount = tier !== null ? BET_TIERS[tier]?.amount : null;

  return (
    <div className="space-y-5">
      {/* Bet tier */}
      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-[#b0aaa3]">押注档位</label>
        <BetTierSelector selected={tier} balance={balance} onChange={setTier} />
        {errors.tier && <p className="text-xs text-red-400/80">{errors.tier}</p>}
        {errors.balance && <p className="text-xs text-red-400/80">{errors.balance}</p>}
      </div>

      {/* Player addresses */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-[#b0aaa3]">玩家 2</label>
          <input
            type="text"
            value={addr2}
            onChange={e => { setAddr2(e.target.value); setErrors(prev => ({ ...prev, addr2: '' })); }}
            placeholder="Solana 公钥"
            className="w-full rounded-xl border border-[rgba(0,0,0,0.05)] bg-[#f0ede7] px-3.5 py-2.5 font-mono text-xs text-[#504a44] placeholder-[#c0bab3] transition-all duration-200"
          />
          {errors.addr2 && <p className="text-[11px] text-red-400/80">{errors.addr2}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-[#b0aaa3]">玩家 3</label>
          <input
            type="text"
            value={addr3}
            onChange={e => { setAddr3(e.target.value); setErrors(prev => ({ ...prev, addr3: '' })); }}
            placeholder="Solana 公钥"
            className="w-full rounded-xl border border-[rgba(0,0,0,0.05)] bg-[#f0ede7] px-3.5 py-2.5 font-mono text-xs text-[#504a44] placeholder-[#c0bab3] transition-all duration-200"
          />
          {errors.addr3 && <p className="text-[11px] text-red-400/80">{errors.addr3}</p>}
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="btn-glow w-full rounded-xl bg-gradient-to-r from-[#6d9a80] to-[#7daa90] py-3 text-sm font-semibold text-white/90 shadow-sm transition-all duration-200 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        <span>{submitting ? '处理中...' : '创建房间'}</span>
      </button>

      <TxStatus txState={txState} onRetry={resetTx} />

      {/* Step-2 recovery banner */}
      {depositRetryId && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-50/40 p-4 text-sm">
          <p className="font-semibold text-amber-800/70">房间已创建，存款失败</p>
          <p className="mt-1 text-xs text-amber-700/50">
            请在"加入房间"里输入以下 ID 重试：
          </p>
          <p className="mt-2 break-all font-mono text-xs text-amber-700/60">{depositRetryId}</p>
          <button
            onClick={() => void navigator.clipboard.writeText(depositRetryId)}
            className="mt-2 rounded-lg border border-amber-400/20 px-3 py-1 text-[11px] text-amber-700/50 transition hover:bg-amber-50/60"
          >
            复制 ID
          </button>
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && tierAmount !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#504a44]/30 backdrop-blur-sm">
          <div className="w-full max-w-sm animate-float-up rounded-2xl border border-[rgba(0,0,0,0.06)] bg-[#f4f1ec] p-6 shadow-xl">
            <h3 className="mb-1 text-base font-semibold text-[#504a44]">确认创建</h3>
            <p className="mb-6 text-sm text-[#8a847e]">
              即将锁定{' '}
              <span className="font-mono font-semibold text-[#b8960b]">
                {tierAmount.toLocaleString()} MEME
              </span>{' '}
              到链上托管账户
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-xl border border-[rgba(0,0,0,0.06)] py-2.5 text-sm text-[#8a847e] transition hover:border-[rgba(0,0,0,0.1)] hover:text-[#6a645e]"
              >
                取消
              </button>
              <button
                onClick={() => void handleConfirm()}
                className="flex-1 rounded-xl bg-[#6d9a80] py-2.5 text-sm font-semibold text-white/90 transition hover:bg-[#5a8069]"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
