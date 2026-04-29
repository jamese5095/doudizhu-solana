import { Router } from 'express';
import type { Request, Response } from 'express';
import type { HistoryRepository } from './HistoryRepository';

// base58 字符集，长度 32-44（覆盖 Solana 公钥）
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createHistoryRouter(repo: HistoryRepository): Router {
  const router = Router();

  router.get('/api/history', async (req: Request, res: Response): Promise<void> => {
    const wallet = req.query['wallet'] as string | undefined;
    if (!wallet || !BASE58_RE.test(wallet)) {
      res.status(400).json({ error: '无效的钱包地址' });
      return;
    }

    const limitRaw = parseInt((req.query['limit'] as string | undefined) ?? '5', 10);
    const limit    = Number.isNaN(limitRaw) ? 5 : Math.min(Math.max(limitRaw, 1), 20);

    try {
      const records = await repo.getByWallet(wallet, limit);
      res.json(records);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[HistoryRouter] 查询失败:', msg);
      res.status(500).json({ error: '内部服务器错误' });
    }
  });

  return router;
}
