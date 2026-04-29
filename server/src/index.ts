/**
 * Doudizhu relay server — 启动入口
 *
 * 初始化顺序：
 *   Redis → RoomManager → BotPlayer → TimeoutManager → GameStateMachine
 *   → Anchor Program → Settler → PostgreSQL → HistoryRepository
 *   → Express HTTP + HistoryRouter → GameGateway (WebSocket on same port)
 *   → 注册 gameOver 监听（结算 + 写历史 + 广播 + 清理房间）
 */

import * as http from 'http';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { Pool } from 'pg';

import { createRedis } from './config';
import { RoomManager } from './room/RoomManager';
import { BotPlayer } from './bot/BotPlayer';
import { TimeoutManager } from './game/TimeoutManager';
import { GameStateMachine } from './game/GameStateMachine';
import type { GameOverPayload } from './game/GameStateMachine';
import { GameGateway } from './gateway/GameGateway';
import { Settler } from './settler/Settler';
import { CancellationKeeper } from './settler/CancellationKeeper';
import { HistoryRepository } from './history/HistoryRepository';
import { createHistoryRouter } from './history/HistoryRouter';
import { SybilDetector } from './anticheat/SybilDetector';
import { RewardPoolService } from './reward/RewardPoolService';
import { LeaderboardService } from './reward/LeaderboardService';
import { createEconomyRouter } from './reward/EconomyRouter';

// ─── 配置常量（从 CLAUDE.md 读取）────────────────────────────────────────────

const DEVNET_RPC   = process.env.SOLANA_RPC   ?? 'https://api.devnet.solana.com';
const PROGRAM_ID   = new PublicKey('CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf');
const MINT         = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');
const TREASURY_ATA = new PublicKey('Bum51FZ9PcLLTSYmwoD4aYrsftV9BDmndMiMg45mbrv8');
const WS_PORT      = parseInt(process.env.WS_PORT ?? '8080', 10);
const DATABASE_URL = process.env.DATABASE_URL   ?? 'postgresql://localhost:5433/doudizhu';

// ─── 加载中继器钱包 ───────────────────────────────────────────────────────────

function loadRelayerKeypair(): Keypair {
  const keyPath = process.env.RELAY_KEYPAIR_PATH
    ?? path.join(process.env.HOME!, '.config/solana/id.json');
  const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ─── IDL ─────────────────────────────────────────────────────────────────────

function loadIdl() {
  // tsx 运行时 __dirname 是 src/，往上找项目根再定位 IDL
  const candidates = [
    path.join(__dirname, '../../../programs/doudizhu/target/idl/programs_doudizhu.json'),
    path.join(__dirname, '../../programs/doudizhu/target/idl/programs_doudizhu.json'),
    path.join(__dirname, '../../packages/frontend/lib/idl.json'),
    path.join(__dirname, '../packages/frontend/lib/idl.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error(`IDL 文件未找到，尝试路径：\n${candidates.join('\n')}`);
}

// ─── 启动 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[Server] 启动中...');

  // Redis
  const redis = createRedis();
  const rm    = new RoomManager(redis);

  // Game subsystems
  const bot     = new BotPlayer();
  const timeout = new TimeoutManager();
  const gsm     = new GameStateMachine(rm, timeout, bot);

  // Anchor / Solana
  const relayerKeypair = loadRelayerKeypair();
  const connection     = new Connection(DEVNET_RPC, 'confirmed');
  const wallet         = new anchor.Wallet(relayerKeypair);
  const provider       = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const program = new Program(loadIdl(), provider);

  // Settler
  const settler = new Settler(rm, program as never, relayerKeypair, MINT, TREASURY_ATA);

  // CancellationKeeper（房间 30s 未开局则自动退款）
  const keeper = new CancellationKeeper(program as never, relayerKeypair, MINT, 35_000);

  // PostgreSQL + HistoryRepository
  const pool = new Pool({ connectionString: DATABASE_URL });
  const historyRepo = new HistoryRepository(pool);

  // 经济模型服务
  const sybilDetector    = new SybilDetector(pool);
  const rewardPoolService = new RewardPoolService(pool, connection as never, relayerKeypair, MINT, TREASURY_ATA);
  const leaderboardService = new LeaderboardService(pool);

  // Express HTTP 应用
  const app = express();
  app.use(express.json());
  app.use(createHistoryRouter(historyRepo));
  app.use(createEconomyRouter(rewardPoolService, leaderboardService));

  // ─── 管理员接口：手动触发超时取消（用于补救已锁定押金的旧房间）────────────────
  // POST /api/admin/cancel-room  body: { roomId: string }
  // 从 Redis 读取玩家地址，调用链上 cancel_room 退款。
  app.post('/api/admin/cancel-room', async (req, res) => {
    try {
      const { roomId } = req.body as { roomId?: string };
      if (!roomId || typeof roomId !== 'string') {
        res.status(400).json({ error: 'roomId 必填' });
        return;
      }
      const state = await rm.getRoom(roomId);
      if (state === null) {
        res.status(404).json({ error: `房间 "${roomId}" 在 Redis 中不存在` });
        return;
      }
      const playerPubkeys = state.players.map(p => p.playerId) as [string, string, string];
      const txSignature = await keeper.cancelNow(roomId, playerPubkeys);
      res.json({ ok: true, txSignature, roomId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // HTTP 服务器（WebSocket 复用同一端口）
  const httpServer = http.createServer(app);

  // WebSocket gateway（挂载到 HTTP server，不单独监听端口）
  const gateway = new GameGateway(rm, gsm, httpServer);
  gateway.setKeeper(keeper);

  // ─── gameOver 监听：结算 → 写历史 → 广播 → 清理 ───────────────────────────

  gsm.on('gameOver', async (event: GameOverPayload) => {
    // 单机模式：虚拟结算（不上链），直接广播并清理
    if (gateway.isSoloRoom(event.roomId)) {
      await gateway.broadcastSoloSettlement(event);
      console.log(`[Server] 单机结算：roomId=${event.roomId} winner=${event.winnerId} ×${event.finalMultiplier}`);
      return;
    }

    try {
      const result = await settler.settle(event);

      // 步骤 6: 写入历史记录（失败只记录日志，不影响结算广播）
      try {
        await historyRepo.saveRecord(result);
      } catch (histErr: unknown) {
        const msg = histErr instanceof Error ? histErr.message : String(histErr);
        console.error(`[HistoryRepo] 写入失败，roomId=${event.roomId}: ${msg}`);
      }

      gateway.broadcastSettlement(result);
      console.log(`[Server] 结算成功：roomId=${event.roomId} tx=${result.txSignature}`);

      // ─── 经济模型步骤 7-10（非阻塞，失败只记录日志）──────────────────
      try {
        const wallets = result.payouts.map(p => p.playerId);
        // 获取玩家 IP（从 gateway 连接信息）
        const playerIps = wallets.map(w => gateway.getPlayerIp(w));

        // 步骤 7: 反作弊质量评分
        const highlightCount = event.bombCount
          + (event.rocketUsed ? 1 : 0)
          + (event.isSpring ? 1 : 0)
          + (event.isAntiSpring ? 1 : 0);

        const quality = await sybilDetector.evaluate(
          event.gameDurationSecs, wallets, playerIps,
        );

        // 更新 game_records 经济字段
        await historyRepo.updateGameQuality(event.roomId, {
          durationSecs:   event.gameDurationSecs,
          qualityWeight:  quality.qualityWeight,
          highlightCount,
          ipConflict:     quality.ipConflict,
        });

        // 步骤 8: 手续费累加到奖励池
        await rewardPoolService.accumulateFee(result.fee);

        // 步骤 9: 更新排行榜
        const cycle = await rewardPoolService.getCurrentCycle();
        await leaderboardService.updateAfterGame(
          cycle.id, wallets, event.winnerId, highlightCount, quality.qualityWeight,
        );

        // 步骤 10: 尝试分配已到期周期
        const distributed = await rewardPoolService.distributeExpiredCycles();
        if (distributed > 0) {
          console.log(`[Economy] 已分配 ${distributed} 个到期奖励周期`);
        }
      } catch (econErr: unknown) {
        const msg = econErr instanceof Error ? econErr.message : String(econErr);
        console.error(`[Economy] 经济模型处理失败，roomId=${event.roomId}: ${msg}`);
      }

      // 清理房间（M4 RoomManager）
      const state = await rm.getRoom(event.roomId);
      if (state !== null) {
        await rm.deleteRoom(event.roomId, state.players.map(p => p.playerId));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Settler] 结算失败，需要人工介入：roomId=${event.roomId} err=${msg}`);
      gateway.broadcastSettlementError(event.roomId);
    }
  });

  // 启动 HTTP + WS 服务器
  await new Promise<void>(resolve => httpServer.listen(WS_PORT, resolve));

  console.log(`[Server] HTTP + WebSocket 监听 :${WS_PORT}`);
  console.log(`[Server] 历史记录接口：GET http://localhost:${WS_PORT}/api/history?wallet=:address`);
  console.log(`[Server] Relay 钱包: ${relayerKeypair.publicKey.toBase58()}`);
  console.log(`[Server] Program ID: ${PROGRAM_ID.toBase58()}`);
}

main().catch(err => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
