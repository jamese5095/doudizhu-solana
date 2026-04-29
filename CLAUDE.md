# 项目约定

## 关键地址
- Devnet 钱包（relay）: FCGAaDzk5KZxsHRpicBbYnXP4jqDyZPo16UfSFdqASWk
- Meme Coin Mint: fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj
- Program ID (devnet): CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf
- Treasury ATA: Bum51FZ9PcLLTSYmwoD4aYrsftV9BDmndMiMg45mbrv8
- Network: devnet
- 部署签名: 5XoSSDU2P3ajXaaGGVhnqgoZFSZq5Tg92piF4pfWiAiLJ53ZngH55UjregCzAsXS5iiUatZGY7bzjuuGMbVQafYQ

## 类型约定
- 倍率统一用整数表示（基础=1，炸弹翻倍=×2，以此类推，结算时相乘）
- 代币金额统一用 BN（lamport 精度），禁止使用 JS number 类型
- 牌面值：3-10=3-10，J=11，Q=12，K=13，A=14，2=15，小王=16，大王=17
- 花色：♠=0，♥=1，♦=2，♣=3（王牌花色=4）

## 服务器约定（随开发推进更新）
- getPlayerRoom 返回值需配合 getRoom 做二次校验，null 或房间不存在均属正常情况，调用方自行处理。
- landlordIndex 和 currentTurnIndex 在 phase !== GamePhase.Playing 时无意义，所有读取方必须先校验 phase。
- deleteRoom(roomId, playerIds) 由调用方显式传入 playerIds，不依赖从 Redis 读取 state，防止 TTL 过期导致 player 索引泄漏。
- handlePlay 的轮次/合法性错误通过 error 字段返回（{ state, error? }），handlePass/handleBid 的非法调用直接 throw，调用方需分别处理。
- onPlayerTimeout 实现：BotPlayer 保守策略（首出出最小非炸弹单张；压牌选同牌型最小；无法压制才用炸弹；整手一次出完优先）。
- botAction 事件格式：{ roomId: string, playerId: string, action: 'PLAY'|'PASS', cards: Card[] }，GameGateway 监听后广播 BOT_ACTION 给房间内所有客户端。
- 技术债（托管机器人已知局限，不影响游戏走到结束，主网后可按需优化）：
  - 复杂牌型（顺子/飞机）不应战，永远 pass
  - 首出轮只出最小单张，非最优
- Settler verifySettlement 说明：verifySettlement 的预期 delta 包含 baseScore 返还，
  即 player delta = baseScore + 净盈亏（地主为正，农民为负），快照基准点为 join_and_deposit 之前的余额。
  实现上：preBalances 快照于 join_and_deposit 之后、settle 之前（玩家存款已扣），
  on-chain settle 从 escrow 退还 deposit+盈亏，故校验时 expectedDelta 需加回 baseScore（每人押金）再对比。
- SETTLEMENT_CONFIRMED 事件格式：{ type: 'SETTLEMENT_CONFIRMED', roomId, txSignature, winnerId, finalMultiplier, payouts: [{playerId, delta: string}], fee: string, verified, settledAt }（bigint 字段统一序列化为 string，前端用 BigInt(v) 解析）
- SETTLEMENT_FAILED 事件格式：{ type: 'SETTLEMENT_FAILED', roomId, message: '结算异常，请联系客服，您的资金安全' }
- 结算失败告警：Settler.settle 抛异常时，index.ts 的 gameOver 监听器 console.error 输出 roomId+错误信息，并通过 gateway.broadcastSettlementError 通知客户端；需配合外部监控（日志聚合/告警）触发人工介入。

## 前端约定（随开发推进更新）
- 前端端口: 3000（next dev 默认）
- 大厅路由: /
- 牌桌路由: /game/[roomId]
- 房间验证 API: GET /api/room/[roomId]（Next.js API route，读取链上 roomAccount PDA）
- lib/idl.json 为 programs/doudizhu/target/idl/programs_doudizhu.json 的副本，需手动保持同步
- **合约重新部署后需同步 packages/frontend/lib/idl.json**（参见 packages/frontend/lib/README.md）
- tsconfig target 改为 ES2020（支持 bigint 字面量）
- Next.js 16 使用 Turbopack，next.config.ts 中设置 turbopack: {} 而非 webpack config

## 模块边界（随开发推进更新）
- types/：只含类型定义，零依赖，零实现代码
- game-engine/：纯函数，禁止 import ws / @solana / 任何 I/O 库
- programs/：只含 Anchor 合约，不含游戏逻辑
- server/：依赖 types 和 game-engine，不反向依赖 frontend

## 质押与房间等级模型
- 玩家质押 DDZ 到协议，系统按质押量级自动分配房间等级（BetTier）
- 每个等级对应一个底分（baseScore），倍率触发后盈亏 = baseScore × finalMultiplier
- 具体档位阈值（minStake / baseScore）在后续开发中确定，不影响类型契约
- 倍率具体数值（M2已确认）：叫地主×1，明牌×2，加倍×2，炸弹×2，春天×2，反春天×2

## 检查门状态
- [x] M1 types 通过 tsc（完成时间：2026-04-16）
- [x] M2 game-engine jest 覆盖率 >90%（97.97% lines，43测试全通过，完成时间：2026-04-17）
- [x] M3 阶段二 anchor test 全绿（7/7，完成时间：2026-04-17）
- [x] M3 阶段三 anchor test 全绿（10/10，完成时间：2026-04-17）
- [x] M3 阶段四 Devnet 真实结算验证（3/3流程，完成时间：2026-04-17）
- [x] M4 3客户端并发测试通过（6/6，完成时间：2026-04-18）
- [x] M4.5 托管机器人完成（50/50全绿，完成时间：2026-04-18）
- [x] M5 Devnet 真实结算验证（12单元+1集成全通过，对账表全✓，完成时间：2026-04-18）
- [x] M6 第一段大厅页面完成（build 零报错，完成时间：2026-04-18）
- [x] M6 第二段牌桌页面完成（build 零报错，完成时间：2026-04-18）；同步修复 BigInt 序列化 bug
- [x] M6 第三段历史记录接口完成（build + tsc 零报错，完成时间：2026-04-18）
- [x] M6 E2E 完整对局测试通过（7步骤完整覆盖，跳过策略验证通过，完成时间：2026-04-18）
- [x] sim-game.ts 完整对局模拟通过（链上结算 ✅，完成时间：2026-04-19）
- [x] 整个项目开发阶段完成（2026-04-19）
- [x] M7 代币经济模型完成（2026-04-28）：economy.ts 常量、3 新数据库表、SybilDetector 反作弊、RewardPoolService 7 天奖励周期、LeaderboardService 排行榜、5 个 API 接口、前端奖励池状态栏+排行榜页

## 依赖启动
- 一键启动：docker-compose up -d（postgres:5432 + redis:6379）
- 首次启动自动执行 schema.sql 建表
- 环境变量参考：.env.example

## 历史记录接口
- PostgreSQL 表：game_records（见 server/src/history/schema.sql）
- 历史记录接口：GET http://localhost:8080/api/history?wallet=:address&limit=5
- SettleResult.betTier: BetTier 映射整数（Small=0 Medium=1 Large=2 Whale=3）
- HTTP + WS 共用同一端口（8080），Express 挂载 API，WS 挂载在同一 httpServer

## 经济模型（M7）
- 常量定义：server/src/lib/economy.ts — 全项目所有经济参数的唯一来源，禁止硬编码
- 反作弊：server/src/anticheat/SybilDetector.ts — 时长权重、冷启动权重、IP 冲突、共谋检测
- 奖励池：server/src/reward/RewardPoolService.ts — 7 天周期，手续费 80% 进池，按排名分配
- 排行榜：server/src/reward/LeaderboardService.ts — 加权评分（40% 对局 + 30% 胜率 + 30% 精彩操作）
- API 路由：server/src/reward/EconomyRouter.ts
  - GET /api/reward-pool — 当前周期状态
  - GET /api/leaderboard — 排行榜（支持分页）
  - GET /api/reward-pool/my?wallet= — 我的奖励
  - POST /api/reward-pool/claim — 领取奖励
  - GET /api/reward-pool/history?wallet= — 领取历史
- 数据库新表：reward_cycles, leaderboard_scores, reward_claims（见 schema.sql）
- game_records 新增字段：duration_secs, quality_weight, highlight_count, ip_conflict
- GameOverPayload 扩展字段：bombCount, rocketUsed, isSpring, isAntiSpring, gameDurationSecs
- 经济模型步骤 7-10 在 gameOver 监听中非阻塞执行，失败仅记录日志，不影响结算广播
- 前端排行榜页面：/leaderboard

## 已知 Bug（已修复）
- **handleCreateRoom 类型错误**：原传 `PlayerState[]` 给 `rm.createRoom()`，该方法期望 `[string, string, string]` → 修复：直接传 `players`（string 数组）
- **并发 READY 竞态**：3个客户端同时发 READY 导致各自只读到未更新的状态，无一触发 startGame → 修复：GameGateway 新增 `withRoomLock(roomId, fn)` 串行化同房间操作
- **sanitized state 手牌为空**：client 0 的视角下其他玩家手牌为空，`myCards.length===0` 误 break → 修复：playing 循环只对 turnIdx===0 读手牌，其他玩家直接 PASS

## E2E 测试
- E2E 测试命令：npx playwright test --headed（有头）/ npx playwright test（无头）
- 测试钱包环境变量：TEST_WALLET_0/1/2（JSON 数字数组，devnet 预充值 0.1 SOL + 5000 MEME）
- CI 跳过条件：TEST_WALLET_* 任意为空则全部 skip，不阻塞 CI 流水线
- GameTable 根元素有 data-phase 属性，供 Playwright 检测游戏阶段
