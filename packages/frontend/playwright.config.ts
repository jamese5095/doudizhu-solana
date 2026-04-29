import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:     './tests/e2e',
  timeout:     5 * 60 * 1000,           // 单测试最多 5 分钟（等待链上确认）
  retries:     0,                        // E2E 不重试，避免链上副作用重复触发
  workers:     1,                        // 强制串行，确保三个 context 按顺序操作
  fullyParallel: false,

  use: {
    baseURL:     'http://localhost:3000',
    headless:    false,                  // 默认有头模式，CI 环境可 PLAYWRIGHT_HEADLESS=true 覆盖
    screenshot:  'only-on-failure',
    trace:       'on-first-retry',
    video:       'off',
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  outputDir: 'test-results',

  // 本地开发时自动启动 Next.js dev server
  // CI 环境请在运行测试前自行启动服务
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url:     'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
