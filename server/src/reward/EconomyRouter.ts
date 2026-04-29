/**
 * EconomyRouter — 经济模型 API 接口
 *
 * GET  /api/reward-pool          当前奖励池状态
 * GET  /api/leaderboard          排行榜（支持分页）
 * GET  /api/reward-pool/my       我的奖励信息
 * POST /api/reward-pool/claim    领取奖励
 * GET  /api/reward-pool/history  领取历史
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RewardPoolService } from './RewardPoolService';
import type { LeaderboardService } from './LeaderboardService';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createEconomyRouter(
  rewardPool: RewardPoolService,
  leaderboard: LeaderboardService,
): Router {
  const router = Router();

  // GET /api/reward-pool — 当前奖励池状态
  router.get('/api/reward-pool', async (_req: Request, res: Response): Promise<void> => {
    try {
      const cycle = await rewardPool.getCurrentCycle();
      const daysRemaining = Math.max(
        0,
        Math.ceil((cycle.cycleEnd - Math.floor(Date.now() / 1000)) / 86_400),
      );
      const topPlayers = await leaderboard.getLeaderboard(cycle.id, 10);
      res.json({ currentCycle: cycle, daysRemaining, topPlayers });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EconomyRouter] reward-pool 查询失败:', msg);
      res.status(500).json({ error: '内部服务器错误' });
    }
  });

  // GET /api/leaderboard — 排行榜
  router.get('/api/leaderboard', async (req: Request, res: Response): Promise<void> => {
    try {
      const cycle = await rewardPool.getCurrentCycle();
      const cycleId = parseInt((req.query['cycleId'] as string) ?? '', 10) || cycle.id;
      const limit  = Math.min(Math.max(parseInt((req.query['limit'] as string) ?? '50', 10) || 50, 1), 100);
      const offset = Math.max(parseInt((req.query['offset'] as string) ?? '0', 10) || 0, 0);

      const entries = await leaderboard.getLeaderboard(cycleId, limit, offset);
      res.json({ cycleId, entries });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EconomyRouter] leaderboard 查询失败:', msg);
      res.status(500).json({ error: '内部服务器错误' });
    }
  });

  // GET /api/reward-pool/my — 我的奖励信息
  router.get('/api/reward-pool/my', async (req: Request, res: Response): Promise<void> => {
    const wallet = req.query['wallet'] as string | undefined;
    if (!wallet || !BASE58_RE.test(wallet)) {
      res.status(400).json({ error: '无效的钱包地址' });
      return;
    }

    try {
      const cycle = await rewardPool.getCurrentCycle();
      const myScore  = await leaderboard.getPlayerScore(cycle.id, wallet);
      const myReward = await rewardPool.getPlayerReward(cycle.id, wallet);
      res.json({ cycleId: cycle.id, myScore, myReward });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EconomyRouter] my-reward 查询失败:', msg);
      res.status(500).json({ error: '内部服务器错误' });
    }
  });

  // POST /api/reward-pool/claim — 领取奖励
  router.post('/api/reward-pool/claim', async (req: Request, res: Response): Promise<void> => {
    const { cycleId, wallet } = req.body as { cycleId?: number; wallet?: string };

    if (!cycleId || typeof cycleId !== 'number') {
      res.status(400).json({ error: 'cycleId 必填（数字）' });
      return;
    }
    if (!wallet || !BASE58_RE.test(wallet)) {
      res.status(400).json({ error: '无效的钱包地址' });
      return;
    }

    try {
      const claim = await rewardPool.claimReward(cycleId, wallet);
      res.json(claim);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EconomyRouter] claim 失败:', msg);
      res.status(400).json({ error: msg });
    }
  });

  // GET /api/reward-pool/history — 领取历史
  router.get('/api/reward-pool/history', async (req: Request, res: Response): Promise<void> => {
    const wallet = req.query['wallet'] as string | undefined;
    if (!wallet || !BASE58_RE.test(wallet)) {
      res.status(400).json({ error: '无效的钱包地址' });
      return;
    }

    try {
      const limitRaw = parseInt((req.query['limit'] as string) ?? '10', 10);
      const limit = Number.isNaN(limitRaw) ? 10 : Math.min(Math.max(limitRaw, 1), 50);
      const claims = await rewardPool.getClaimHistory(wallet, limit);
      res.json(claims);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EconomyRouter] claim-history 查询失败:', msg);
      res.status(500).json({ error: '内部服务器错误' });
    }
  });

  return router;
}
