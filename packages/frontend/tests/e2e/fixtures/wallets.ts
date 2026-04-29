/**
 * wallets.ts — E2E 测试用钱包配置
 *
 * 安全约定：
 *   - 私钥绝不提交到代码仓库，通过环境变量注入
 *   - 三个测试钱包需在 devnet 预充值：至少 0.1 SOL（手续费）+ 5000 DDZ MEME（押注）
 *   - 生成方式：solana-keygen new --outfile test-wallet-{n}.json
 *   - 导出为环境变量：export TEST_WALLET_0=$(cat test-wallet-0.json)
 *
 * 本地开发：在 packages/frontend/.env.test 里配置（已加入 .gitignore）
 *   TEST_WALLET_0=[1,2,3,...]
 *   TEST_WALLET_1=[1,2,3,...]
 *   TEST_WALLET_2=[1,2,3,...]
 */

import { Keypair } from '@solana/web3.js';

function loadKeypair(envVar: string, index: number): Keypair {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(
      `缺少环境变量 ${envVar}。` +
      `请先生成测试钱包并设置环境变量，详见 tests/e2e/fixtures/wallets.ts 顶部注释。`,
    );
  }
  try {
    const bytes = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new Error(`${envVar} 格式无效（应为 JSON 数字数组），玩家索引: ${index}`);
  }
}

export const TEST_WALLETS = [
  loadKeypair('TEST_WALLET_0', 0),
  loadKeypair('TEST_WALLET_1', 1),
  loadKeypair('TEST_WALLET_2', 2),
] as const;

export type TestWallet = typeof TEST_WALLETS[number];
