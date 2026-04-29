/**
 * gameHelpers.ts — 游戏流程等待工具函数
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * 等待游戏进入指定阶段（通过 data-phase 属性检测）。
 * GameTable 根元素需设置 data-phase={gameState.phase}。
 */
export async function waitForPhase(
  page: Page,
  phase: 'waiting' | 'bidding' | 'playing' | 'ended',
  timeout = 30_000,
): Promise<void> {
  await page.locator(`[data-phase="${phase}"]`).waitFor({ state: 'visible', timeout });
}

/**
 * 等待轮到当前玩家出牌（ActionBar 的出牌按钮变为可点击）。
 * 超时表示游戏一直不到本玩家，可能已结束。
 */
export async function waitForMyTurn(page: Page, timeout = 35_000): Promise<void> {
  await page
    .getByRole('button', { name: '出牌' })
    .and(page.locator(':not([disabled])'))
    .waitFor({ state: 'visible', timeout });
}

/**
 * 等待轮到当前玩家叫地主（叫地主按钮可点击）。
 */
export async function waitForMyBidTurn(page: Page, timeout = 35_000): Promise<void> {
  await page
    .getByRole('button', { name: '叫地主' })
    .and(page.locator(':not([disabled])'))
    .waitFor({ state: 'visible', timeout });
}

/**
 * 点击"提示"自动选牌，再点击"出牌"。
 * 若提示无牌可出则点击"不出"。
 */
export async function playHintCard(page: Page): Promise<void> {
  const hintBtn = page.getByRole('button', { name: '提示' });
  await hintBtn.click();

  // 检查"出牌"是否可用（提示成功选到了合法牌）
  const playBtn = page.getByRole('button', { name: '出牌' });
  const isEnabled = await playBtn.isEnabled();

  if (isEnabled) {
    await playBtn.click();
  } else {
    // 提示未找到可出的牌（或没有可以压过上家的牌），选择不出
    await page.getByRole('button', { name: '不出' }).click();
  }
}

/**
 * 等待结算弹窗出现并确认加载完成（spinner 消失）。
 */
export async function waitForSettlement(page: Page, timeout = 60_000): Promise<void> {
  // 先等 SettlementModal 出现（gameOver = true）
  await expect(
    page.getByText(/结算确认中|赢了|输了|结算异常/).first(),
  ).toBeVisible({ timeout });

  // 再等 spinner 消失（settled）
  await expect(
    page.getByText('结算确认中').first(),
  ).not.toBeVisible({ timeout });
}

/**
 * 截图并保存到 test-results/，文件名携带时间戳防覆盖。
 */
export async function snapshot(page: Page, name: string): Promise<void> {
  const ts   = Date.now();
  const safe = name.replace(/[^a-z0-9_\-]/gi, '_');
  await page.screenshot({ path: `test-results/${safe}_${ts}.png`, fullPage: false });
}
