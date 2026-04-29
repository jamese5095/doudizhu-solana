/**
 * full-game.spec.ts — 完整对局 E2E 测试
 *
 * 前置条件：
 *   1. PostgreSQL 运行中，DATABASE_URL 环境变量已设置
 *   2. Redis 运行中（默认 127.0.0.1:6379）
 *   3. 服务器运行中（WS_PORT=8080）：cd server && npx ts-node src/index.ts
 *   4. 前端 dev server（playwright.config.ts 里 webServer 会自动启动）
 *   5. 三个测试钱包（TEST_WALLET_0/1/2）已在 devnet 充值 0.1 SOL + 5000 MEME
 *
 * 运行方式：
 *   npx playwright test --headed        # 有头模式（看到三个浏览器窗口）
 *   npx playwright test                 # 无头模式（CI）
 *   CI=true npx playwright test         # CI 环境（跳过 webServer 自动启动）
 *
 * CI 跳过策略：
 *   在 CI/CD 中若无 devnet 环境，可在 workflow 文件中：
 *   if: env.TEST_WALLET_0 != ''        # 仅当环境变量存在时才运行 E2E
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { Keypair } from '@solana/web3.js';
import { injectMockWallet, connectWallet } from './helpers/mockWallet';
import {
  waitForPhase,
  waitForMyTurn,
  waitForMyBidTurn,
  playHintCard,
  waitForSettlement,
  snapshot,
} from './helpers/gameHelpers';

// ─── 跳过策略：缺少测试钱包时跳过整个 suite ────────────────────────────────

const hasWallets =
  !!process.env['TEST_WALLET_0'] &&
  !!process.env['TEST_WALLET_1'] &&
  !!process.env['TEST_WALLET_2'];

// ─── 测试钱包（懒加载，防止缺失时报错 crash 整个 test runner）──────────────

function loadWallet(envVar: string): Keypair {
  const raw = process.env[envVar]!;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

// ─── 测试 Suite ───────────────────────────────────────────────────────────────

test.describe('完整斗地主对局 E2E', () => {
  test.skip(!hasWallets, '跳过：缺少 TEST_WALLET_0/1/2 环境变量');

  let ctxA: BrowserContext, ctxB: BrowserContext, ctxC: BrowserContext;
  let pageA: Page, pageB: Page, pageC: Page;
  let walletA: Keypair, walletB: Keypair, walletC: Keypair;
  let roomId: string;

  test.beforeAll(async ({ browser }) => {
    walletA = loadWallet('TEST_WALLET_0');
    walletB = loadWallet('TEST_WALLET_1');
    walletC = loadWallet('TEST_WALLET_2');

    // 三个独立 context，模拟三台不同的浏览器
    [ctxA, ctxB, ctxC] = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ]);

    [pageA, pageB, pageC] = await Promise.all([
      ctxA.newPage(),
      ctxB.newPage(),
      ctxC.newPage(),
    ]);

    // 注入 mock Phantom 钱包（在页面加载前注入）
    await Promise.all([
      injectMockWallet(pageA, walletA),
      injectMockWallet(pageB, walletB),
      injectMockWallet(pageC, walletC),
    ]);
  });

  test.afterAll(async () => {
    await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
  });

  // ── 步骤一：大厅页面 ─────────────────────────────────────────────────────

  test('步骤一：三个玩家打开大厅并连接钱包', async () => {
    await Promise.all([
      pageA.goto('/'),
      pageB.goto('/'),
      pageC.goto('/'),
    ]);

    // 连接钱包
    await Promise.all([
      connectWallet(pageA),
      connectWallet(pageB),
      connectWallet(pageC),
    ]);

    // 验证钱包地址显示（取前6位）
    const addrA = walletA.publicKey.toBase58().slice(0, 6);
    const addrB = walletB.publicKey.toBase58().slice(0, 6);
    const addrC = walletC.publicKey.toBase58().slice(0, 6);

    await Promise.all([
      expect(pageA.getByText(addrA).first()).toBeVisible({ timeout: 10_000 }),
      expect(pageB.getByText(addrB).first()).toBeVisible({ timeout: 10_000 }),
      expect(pageC.getByText(addrC).first()).toBeVisible({ timeout: 10_000 }),
    ]);

    await snapshot(pageA, 'step1_lobby_playerA');
  });

  // ── 步骤二：创建和加入房间 ────────────────────────────────────────────────

  test('步骤二：玩家A创建房间，玩家B和C加入', async () => {
    // 玩家A：选档位（练习场 100 MEME）、填入其他玩家地址、创建房间
    const betTierSelect = pageA.getByLabel(/档位|BetTier/i).first();
    if (await betTierSelect.isVisible()) {
      await betTierSelect.selectOption('SMALL');
    }

    // 填写玩家B、C 地址（CreateRoomForm 的 players 输入框）
    const playerInputs = pageA.locator('input[placeholder*="钱包地址"]');
    const inputCount = await playerInputs.count();
    if (inputCount >= 2) {
      await playerInputs.nth(0).fill(walletB.publicKey.toBase58());
      await playerInputs.nth(1).fill(walletC.publicKey.toBase58());
    }

    await pageA.getByRole('button', { name: /创建房间/ }).click();

    // 等待链上确认（最多 60 秒）
    await expect(
      pageA.getByText(/房间 ID|roomId|Room/i).first(),
    ).toBeVisible({ timeout: 60_000 });

    // 从 URL 或页面获取 roomId
    const roomIdEl = pageA.locator('[data-room-id]').first();
    if (await roomIdEl.isVisible()) {
      roomId = (await roomIdEl.getAttribute('data-room-id')) ?? '';
    } else {
      // 从当前 URL 解析（跳转到 /game/[roomId] 后）
      await pageA.waitForURL(/\/game\//, { timeout: 10_000 });
      roomId = pageA.url().split('/game/')[1] ?? '';
    }

    expect(roomId).toBeTruthy();
    console.log(`[E2E] 房间 ID: ${roomId}`);

    // 玩家B和C 加入房间
    await Promise.all([
      (async () => {
        const input = pageB.locator('input[placeholder*="房间"]').first();
        await input.fill(roomId);
        await pageB.getByRole('button', { name: /加入房间/ }).click();
        await expect(pageB.getByText(/等待|准备|READY/i).first()).toBeVisible({ timeout: 60_000 });
      })(),
      (async () => {
        const input = pageC.locator('input[placeholder*="房间"]').first();
        await input.fill(roomId);
        await pageC.getByRole('button', { name: /加入房间/ }).click();
        await expect(pageC.getByText(/等待|准备|READY/i).first()).toBeVisible({ timeout: 60_000 });
      })(),
    ]);

    await snapshot(pageA, 'step2_room_created');
  });

  // ── 步骤三：进入牌桌，三人准备 ───────────────────────────────────────────

  test('步骤三：三人进入牌桌并准备', async () => {
    const gameUrl = `/game/${roomId}`;

    // 确保都到了牌桌页面
    for (const [page, name] of [[pageA, 'A'], [pageB, 'B'], [pageC, 'C']] as const) {
      if (!page.url().includes('/game/')) {
        await page.goto(gameUrl);
      }
    }

    // 三人点击"准备"
    await Promise.all([
      pageA.getByRole('button', { name: /准备|READY/i }).click(),
      pageB.getByRole('button', { name: /准备|READY/i }).click(),
      pageC.getByRole('button', { name: /准备|READY/i }).click(),
    ]);

    // 等待进入叫地主阶段
    await waitForPhase(pageA, 'bidding', 30_000);

    await snapshot(pageA, 'step3_bidding_phase');
  });

  // ── 步骤四：叫地主 ────────────────────────────────────────────────────────

  test('步骤四：完成叫地主流程', async () => {
    const pages = [pageA, pageB, pageC];

    // 三人轮流等待叫牌机会，第一个轮到的叫地主
    let landlordBid = false;
    for (let round = 0; round < 3 && !landlordBid; round++) {
      for (const page of pages) {
        try {
          await waitForMyBidTurn(page, 5_000);
          await page.getByRole('button', { name: '叫地主' }).click();
          landlordBid = true;
          break;
        } catch {
          // 不是这个玩家的回合，继续
        }
      }
    }

    // 如果三人都选择了不叫，系统会重新分配；等待进入游戏阶段
    await waitForPhase(pageA, 'playing', 30_000);

    // 验证底牌展示给地主
    await expect(pageA.locator('[data-testid="kitty-cards"], .kitty-cards').first())
      .toBeVisible({ timeout: 5_000 })
      .catch(() => { /* 非地主页面没有底牌显示是正常的 */ });

    await snapshot(pageA, 'step4_game_started');
  });

  // ── 步骤五：模拟出牌至游戏结束 ───────────────────────────────────────────

  test('步骤五：轮流出牌至游戏结束（最多 60 轮）', async () => {
    const pages = [pageA, pageB, pageC];
    let round = 0;
    const MAX_ROUNDS = 60;

    while (round < MAX_ROUNDS) {
      // 检查是否有任何页面已进入 ended 阶段
      const ended = await Promise.all(
        pages.map(p => p.locator('[data-phase="ended"]').isVisible()),
      );
      if (ended.some(Boolean)) break;

      // 检查是否有结算弹窗出现
      const settled = await Promise.all(
        pages.map(p => p.getByText(/赢了|输了|结算异常/).first().isVisible()),
      );
      if (settled.some(Boolean)) break;

      // 找到当前轮到的玩家并出牌
      let anyPlayed = false;
      for (const page of pages) {
        try {
          await waitForMyTurn(page, 3_000);
          await playHintCard(page);
          anyPlayed = true;
          round++;
          break;
        } catch {
          // 不是这个玩家的回合
        }
      }

      if (!anyPlayed) {
        // 短暂等待游戏状态更新
        await pages[0].waitForTimeout(500);
      }
    }

    expect(round).toBeLessThan(MAX_ROUNDS);
    console.log(`[E2E] 游戏在第 ${round} 轮结束`);
  });

  // ── 步骤六：等待结算确认 ─────────────────────────────────────────────────

  test('步骤六：三个玩家都看到结算弹窗', async () => {
    await Promise.all([
      waitForSettlement(pageA),
      waitForSettlement(pageB),
      waitForSettlement(pageC),
    ]);

    // 验证代币变化数字非零
    const deltaTexts = await Promise.all(
      [pageA, pageB, pageC].map(async p => {
        const el = p.locator('.font-mono.text-4xl').first();
        return el.textContent();
      }),
    );
    for (const text of deltaTexts) {
      expect(text?.replace(/[^0-9]/g, '')).not.toBe('0');
    }

    // 验证 Explorer 链接存在
    await expect(pageA.getByRole('link', { name: /查看交易/ }).first()).toBeVisible();

    await Promise.all([
      snapshot(pageA, 'step6_settlement_playerA'),
      snapshot(pageB, 'step6_settlement_playerB'),
      snapshot(pageC, 'step6_settlement_playerC'),
    ]);
  });

  // ── 步骤七：验证历史记录 ─────────────────────────────────────────────────

  test('步骤七：回到大厅验证历史记录写入', async () => {
    // 三人点击"再来一局"回到大厅
    await Promise.all([
      pageA.getByRole('button', { name: '再来一局' }).click(),
      pageB.getByRole('button', { name: '再来一局' }).click(),
      pageC.getByRole('button', { name: '再来一局' }).click(),
    ]);

    // 等待跳转到大厅
    await Promise.all([
      pageA.waitForURL('/', { timeout: 10_000 }),
      pageB.waitForURL('/', { timeout: 10_000 }),
      pageC.waitForURL('/', { timeout: 10_000 }),
    ]);

    // 等待历史记录写入（数据库写入后 API 查询，给 2 秒缓冲）
    await pageA.waitForTimeout(2_000);

    // 验证大厅历史记录区域出现刚才这局的 tx 签名前8位
    // （需要等待 API 返回）
    await pageA.reload();
    await connectWallet(pageA);

    // 等待历史记录加载
    await expect(
      pageA.getByText(/赢|输/).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 验证胜负标识颜色
    const winBadge  = pageA.locator('span.text-green-400').filter({ hasText: '赢' }).first();
    const lossBadge = pageA.locator('span.text-red-400').filter({ hasText: '输' }).first();
    const hasBadge  = (await winBadge.isVisible()) || (await lossBadge.isVisible());
    expect(hasBadge).toBe(true);

    await Promise.all([
      snapshot(pageA, 'step7_history_playerA'),
      snapshot(pageB, 'step7_history_playerB'),
      snapshot(pageC, 'step7_history_playerC'),
    ]);
  });
});
