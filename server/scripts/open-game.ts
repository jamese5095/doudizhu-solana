/**
 * open-game.ts — 一键开启三个浏览器窗口进行本地对局
 *
 * 运行方式（在项目根目录）：
 *   npx tsx scripts/open-game.ts
 *
 * 前置条件：
 *   1. 已运行 npx tsx scripts/devnet-setup.ts（钱包已充值）
 *   2. docker-compose up -d（Redis + PostgreSQL 已启动）
 *   3. cd server && npm run dev（服务器已启动）
 *   4. cd packages/frontend && npm run dev（前端已启动）
 *
 * 效果：弹出3个 Chromium 窗口，每个窗口已注入对应测试钱包，
 *       访问 http://localhost:3000，点击"连接钱包"即可开始。
 */

// Playwright 安装在 packages/frontend/，从那里引用
import { chromium } from '../../packages/frontend/node_modules/@playwright/test/index.js';
import { Keypair, Transaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const WALLETS_DIR  = path.join(__dirname, 'test-wallets');
const LOBBY_URL    = 'http://localhost:3000';
const PLAYER_NAMES = ['玩家A（红）', '玩家B（蓝）', '玩家C（绿）'];

function loadWallet(index: number): Keypair {
  const filePath = path.join(WALLETS_DIR, `wallet-${index}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `找不到 ${filePath}\n请先运行：npx tsx scripts/devnet-setup.ts`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function setupWindow(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  keypair: Keypair,
  playerName: string,
) {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  const address = keypair.publicKey.toBase58();

  // 签名函数：Node.js 侧签名，通过 exposeFunction 桥接到浏览器
  await page.exposeFunction('_mockSignTx', (serialized: number[]): number[] => {
    const tx = Transaction.from(Buffer.from(serialized));
    tx.sign(keypair);
    return Array.from(tx.serialize({ requireAllSignatures: false }));
  });

  await page.exposeFunction('_mockSignAllTxs', (all: number[][]): number[][] =>
    all.map(s => {
      const tx = Transaction.from(Buffer.from(s));
      tx.sign(keypair);
      return Array.from(tx.serialize({ requireAllSignatures: false }));
    }),
  );

  // 注入 window.phantom.solana
  await page.addInitScript((addr: string) => {
    const pk = {
      toBase58:  () => addr,
      toString:  () => addr,
      toBytes:   () => new Uint8Array(32),
      equals:    (o: { toBase58: () => string }) => o.toBase58() === addr,
    };

    (window as Record<string, unknown>)['phantom'] = {
      solana: {
        isPhantom:   true,
        publicKey:   pk,
        isConnected: false,

        connect: async () => {
          const p = (window as Record<string, unknown>)['phantom'] as Record<string, unknown>;
          const s = p['solana'] as Record<string, unknown>;
          s['isConnected'] = true;
          return { publicKey: pk };
        },

        disconnect: async () => {},

        signTransaction: async (tx: {
          serialize: (o?: { requireAllSignatures?: boolean }) => Buffer;
        }) => {
          const raw    = tx.serialize({ requireAllSignatures: false });
          const signed = await (window as Record<string, unknown>)['_mockSignTx'](
            Array.from(raw),
          ) as number[];
          // web3.js 已被 Next.js 加载，可用 Transaction.from
          const w3 = (window as Record<string, unknown>)['solanaWeb3'] as
            { Transaction?: { from: (b: Buffer) => unknown } } | undefined;
          return w3?.Transaction?.from(Buffer.from(signed)) ?? tx;
        },

        signAllTransactions: async (txs: Array<{
          serialize: (o?: { requireAllSignatures?: boolean }) => Buffer;
        }>) => {
          const allRaw   = txs.map(t => Array.from(t.serialize({ requireAllSignatures: false })));
          const allSigned = await (window as Record<string, unknown>)['_mockSignAllTxs'](
            allRaw,
          ) as number[][];
          const w3 = (window as Record<string, unknown>)['solanaWeb3'] as
            { Transaction?: { from: (b: Buffer) => unknown } } | undefined;
          return allSigned.map(s => w3?.Transaction?.from(Buffer.from(s)) ?? s);
        },

        on:  () => {},
        off: () => {},
      },
    };
  }, address);

  await page.goto(LOBBY_URL);

  // 标题注入，方便区分三个窗口
  await page.evaluate((name: string) => {
    document.title = name;
  }, playerName);

  // 自动点击连接钱包
  try {
    const btn = page.getByRole('button', { name: /连接钱包|Connect Wallet/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 8_000 });
    await btn.click();
    // 选择 Phantom（若有选择器弹窗）
    const phantom = page.getByRole('button', { name: /Phantom/i }).first();
    if (await phantom.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await phantom.click();
    }
  } catch {
    // 连接钱包按钮还未出现（前端未就绪），忽略，玩家手动点击即可
  }

  console.log(`✓ ${playerName}：${address.slice(0, 8)}...  已打开`);
  return { ctx, page };
}

async function main() {
  console.log('加载测试钱包...');
  const wallets = [0, 1, 2].map(i => loadWallet(i));

  wallets.forEach((w, i) => {
    console.log(`  钱包 ${i}: ${w.publicKey.toBase58()}`);
  });

  console.log('\n启动浏览器...');
  const browser = await chromium.launch({ headless: false, slowMo: 50 });

  const windows = await Promise.all(
    wallets.map((kp, i) => setupWindow(browser, kp, PLAYER_NAMES[i]!)),
  );

  console.log('\n✅ 三个窗口已打开！操作步骤：');
  console.log('  1. 玩家A：选择"练习场"档位，填入玩家B、C的地址，点击"创建房间"');
  console.log(`     玩家B 地址：${wallets[1]!.publicKey.toBase58()}`);
  console.log(`     玩家C 地址：${wallets[2]!.publicKey.toBase58()}`);
  console.log('  2. 等待链上确认，复制房间ID');
  console.log('  3. 玩家B / 玩家C：在"加入房间"输入框填入房间ID，点击加入');
  console.log('  4. 三人进入牌桌后各自点击"我准备好了"');
  console.log('  5. 按提示叫地主、出牌，直到结算弹窗出现');
  console.log('\n关闭此终端窗口即可关闭所有浏览器。\n');

  // 等待浏览器关闭
  await new Promise<void>(resolve => {
    browser.on('disconnected', resolve);
    // 监听 Ctrl+C
    process.on('SIGINT', async () => {
      await browser.close();
      resolve();
    });
  });
}

main().catch(e => {
  console.error('启动失败:', e);
  process.exit(1);
});
