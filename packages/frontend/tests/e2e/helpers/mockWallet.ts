/**
 * mockWallet.ts — 注入 mock Phantom 钱包
 *
 * 方案：
 *   1. page.exposeFunction('_signTx') 在 Node.js 侧用真实 Keypair 签名
 *   2. page.addInitScript 注入 window.phantom.solana，signTransaction 回调到 Node.js
 *   3. 前端 wallet-adapter 会优先检测 window.phantom.solana（Phantom 协议）
 *
 * 安全边界：
 *   - 测试私钥只存在于 Node.js 测试进程内存中，不暴露给 DOM
 *   - _signTx 通道仅在测试上下文存在（page.close() 后自动销毁）
 *   - 绝不在生产环境中使用此文件
 */

import type { Page } from '@playwright/test';
import {
  Keypair,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

export async function injectMockWallet(page: Page, keypair: Keypair): Promise<void> {
  const address = keypair.publicKey.toBase58();

  // Node.js 侧签名函数，通过 exposeFunction 暴露给浏览器
  await page.exposeFunction(
    '_mockSignTx',
    (serialized: number[]): number[] => {
      const tx = Transaction.from(Buffer.from(serialized));
      tx.sign(keypair);
      return Array.from(tx.serialize({ requireAllSignatures: false }));
    },
  );

  await page.exposeFunction(
    '_mockSignAllTxs',
    (allSerialized: number[][]): number[][] => {
      return allSerialized.map(s => {
        const tx = Transaction.from(Buffer.from(s));
        tx.sign(keypair);
        return Array.from(tx.serialize({ requireAllSignatures: false }));
      });
    },
  );

  // 浏览器侧注入 window.phantom
  await page.addInitScript((addr: string) => {
    const publicKeyObj = {
      toBase58:  () => addr,
      toString:  () => addr,
      toBytes:   () => new Uint8Array(32), // 占位，wallet-adapter 不直接使用 toBytes
      equals:    (other: { toBase58: () => string }) => other.toBase58() === addr,
      toJSON:    () => addr,
    };

    (window as unknown as Record<string, unknown>).phantom = {
      solana: {
        isPhantom:   true,
        publicKey:   publicKeyObj,
        isConnected: false,

        connect: async (_opts?: { onlyIfTrusted?: boolean }) => {
          (window as unknown as Record<string, unknown>).phantom = {
            ...(window as unknown as { phantom: Record<string, unknown> }).phantom,
            solana: {
              ...(window as unknown as { phantom: { solana: Record<string, unknown> } }).phantom.solana,
              isConnected: true,
            },
          };
          return { publicKey: publicKeyObj };
        },

        disconnect: async () => {
          (window as unknown as Record<string, unknown>)._phantomConnected = false;
        },

        signTransaction: async (tx: unknown) => {
          // 序列化，交给 Node.js 签名，再反序列化
          const raw = (tx as { serialize: (o?: { requireAllSignatures?: boolean }) => Buffer })
            .serialize({ requireAllSignatures: false });
          const signed = await (window as unknown as {
            _mockSignTx: (s: number[]) => Promise<number[]>
          })._mockSignTx(Array.from(raw));
          // 重建 Transaction（浏览器里 @solana/web3.js 已加载）
          const w = window as unknown as { solanaWeb3?: { Transaction?: { from: (b: Buffer) => unknown } } };
          if (w.solanaWeb3?.Transaction?.from) {
            return w.solanaWeb3.Transaction.from(Buffer.from(signed));
          }
          // fallback：直接返回原始对象（adapter 会用 serialize 后的字节发送）
          return tx;
        },

        signAllTransactions: async (txs: unknown[]) => {
          const allRaw = (txs as Array<{ serialize: (o?: { requireAllSignatures?: boolean }) => Buffer }>)
            .map(tx => Array.from(tx.serialize({ requireAllSignatures: false })));
          const allSigned = await (window as unknown as {
            _mockSignAllTxs: (s: number[][]) => Promise<number[][]>
          })._mockSignAllTxs(allRaw);
          return allSigned.map(s => {
            const w = window as unknown as { solanaWeb3?: { Transaction?: { from: (b: Buffer) => unknown } } };
            if (w.solanaWeb3?.Transaction?.from) {
              return w.solanaWeb3.Transaction.from(Buffer.from(s));
            }
            return s; // fallback
          });
        },

        // VersionedTransaction 支持（Next.js wallet-adapter 可能使用）
        signAndSendTransaction: async (tx: unknown) => {
          return { signature: 'mock-sig-' + Date.now() };
        },

        on:  (_event: string, _handler: unknown) => {},
        off: (_event: string, _handler: unknown) => {},
        removeAllListeners: (_event?: string) => {},
      },
    };
  }, address);
}

/**
 * 等待钱包连接按钮出现并点击，触发 mock 连接流程。
 */
export async function connectWallet(page: Page): Promise<void> {
  // wallet-adapter-react-ui 默认按钮文字
  const btn = page.getByRole('button', { name: /连接钱包|Connect Wallet/i }).first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();

  // 弹出钱包选择器后选择 Phantom
  const phantomOption = page.getByRole('button', { name: /Phantom/i }).first();
  if (await phantomOption.isVisible()) {
    await phantomOption.click();
  }
}
