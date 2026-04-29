# 链上斗地主 / Doudizhu on Solana

> A fully on-chain Dou Dizhu (斗地主) poker game powered by Solana blockchain with real-time multiplayer, bot players, automated settlement, and a built-in token economy.

**语言 / Language:** [English](#english) | [中文](#中文)

---

## English

### Overview

Doudizhu on Solana is a decentralized, trustless implementation of the classic Chinese card game "Dou Dizhu" (斗地主). Game state is stored on-chain via Solana programs (Anchor), while a relay server handles real-time event broadcasting. Players stake tokens to enter rooms, and all winnings/losings are settled automatically by the smart contract — no trusted third party required.

### Architecture

```
doudizhu-solana/
├── programs/
│   └── doudizhu/              # Anchor/Solana smart contract (Rust)
├── packages/
│   ├── types/                  # Shared TypeScript interfaces (zero-dependency)
│   ├── game-engine/            # Pure game logic (no I/O, no Solana deps)
│   └── frontend/              # Next.js web UI (wallet connect + game table)
└── server/
    ├── src/
    │   ├── index.ts            # Entry point (Express + WebSocket)
    │   ├── game/               # GameStateMachine, state management
    │   ├── gateway/            # WebSocket gateway, IP tracking
    │   ├── settler/            # On-chain settlement logic
    │   ├── history/            # PostgreSQL game records
    │   ├── reward/             # Reward pool, leaderboard, economy API
    │   ├── anticheat/          # Sybil detection, collusion analysis
    │   └── lib/                # Economy constants, shared utilities
    └── docker-compose.yml
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Smart Contract | Solana / Anchor (Rust), Token-2022, SPL Token |
| Frontend | Next.js 16 + React 19 + Tailwind CSS 4 |
| Game Engine | Pure TypeScript (Jest, 97%+ line coverage) |
| Relay Server | Express 5 + WebSocket + Redis + PostgreSQL |
| Wallet | Solana Wallet Adapter |
| Infrastructure | Docker Compose (PostgreSQL + Redis) |

### Key Features

- **On-chain settlement** — Anchor program escrows stakes and settles atomically; 2% protocol fee deducted on-chain
- **Real-time multiplayer** — WebSocket relay broadcasts game events to all room participants
- **Bot players** — Solo practice mode with managed bots (basic conservative strategy)
- **Multiple bet tiers** — 4 room levels (Small / Medium / Large / Whale) with different stake requirements
- **Multiplier system** — Bomb ×2, Spring ×2, Anti-Spring ×2, Double ×2 — all applied atomically
- **Token economy** — 7-day reward cycles, weighted leaderboard scoring, anti-sybil protection
- **Game history** — Full PostgreSQL record of every completed game
- **E2E testing** — Playwright test suite covering the complete game flow

---

### Token Economy

The token economy model incentivizes genuine gameplay while discouraging exploitation. It operates entirely off-chain (no contract modifications needed), using data from on-chain settlement events.

#### Fee Flow

```
Player stakes → On-chain escrow → Settlement
                                      │
                                      ├── 2% fee (on-chain, fixed in contract)
                                      │     ├── 80% → Reward Pool
                                      │     └── 20% → Treasury (protocol revenue)
                                      │
                                      └── 98% → Winners/Losers payout
```

#### 7-Day Reward Cycles

Fees accumulate into a **reward pool** over 7-day rolling cycles. At the end of each cycle, the pool is distributed to top-ranking players based on their weighted score.

#### Leaderboard Scoring

Player scores are calculated using a **weighted formula** that balances volume, skill, and entertainment value:

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Games played | 40% | Rewards active participation |
| Win rate | 30% | Rewards skill and consistency |
| Highlights | 30% | Rewards exciting play (bombs, rockets, springs) |

**Highlights** include: bombs, rockets (double joker), spring (地主一手出完), and anti-spring (农民一手出完).

Each factor is normalized against the cycle's top performer, then combined:

```
score = 0.4 × (games / maxGames) + 0.3 × winRate + 0.3 × (highlights / maxHighlights)
```

#### Anti-Sybil Protection

To prevent farming and exploitation, every game's reward weight is adjusted by multiple quality signals:

| Check | Mechanism | Effect |
|-------|-----------|--------|
| **Duration weight** | Games < 30s → 0.0 weight; 30–60s → 0.2; 1–2min → 0.5; 2–5min → 0.8; ≥5min → 1.0 | Penalizes speed-run farming |
| **Warmup factor** | New accounts: weight = min(gamesPlayed / 10, 1.0) | Prevents sybil new-account spam |
| **IP conflict** | Flags games where multiple players share the same IP | Detects self-play |
| **Collusion detection** | Two wallets co-occurring ≥5 times in 7 days → flagged, reward weight → 0 | Detects coordinated farming |

#### Reward Claiming

Players can claim their rewards after a cycle ends. Claims trigger an on-chain SPL token transfer from the treasury ATA to the player's wallet via the relay. Minimum claim threshold: 1,000 lamports (prevents dust transactions).

---

### Development Setup

**Prerequisites:** Node.js 18+, Rust + Solana CLI, Docker

```bash
# 1. Clone
git clone https://github.com/jamese5095/doudizhu-solana.git
cd doudizhu-solana

# 2. Install dependencies
npm install

# 3. Start infrastructure
docker-compose up -d    # PostgreSQL + Redis

# 4. Configure environment
cp .env.example .env.local

# 5. Build & deploy Anchor program (devnet)
cd programs/doudizhu
anchor build && anchor deploy

# 6. Sync IDL to frontend
cp target/idl/programs_doudizhu.json ../../packages/frontend/lib/idl.json

# 7. Start relay server
cd ../../server && npm run dev

# 8. Start frontend (new terminal)
cd packages/frontend && npm run dev
```

- **Frontend:** http://localhost:3000
- **Relay API + WebSocket:** http://localhost:8080

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SOLANA_RPC` | Solana RPC endpoint (devnet) |
| `RELAY_KEYPAIR_PATH` | Path to relay wallet keypair |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL for frontend |
| `NEXT_PUBLIC_SERVER_URL` | Server HTTP URL for frontend |

### Testing

```bash
# Game engine unit tests (97%+ coverage)
cd packages/game-engine && npm test

# Settler unit tests (12/12)
cd server && npm test

# Anchor program tests (10/10)
cd programs/doudizhu && anchor test

# E2E (requires funded devnet wallets in TEST_WALLET_0/1/2)
cd packages/frontend && npx playwright test
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reward-pool` | Current reward cycle status |
| GET | `/api/leaderboard?limit=&offset=` | Leaderboard rankings |
| GET | `/api/reward-pool/my?wallet=` | Player's reward for current cycle |
| POST | `/api/reward-pool/claim` | Claim reward (body: `{cycleId, wallet}`) |
| GET | `/api/reward-pool/history?wallet=` | Claim history |
| GET | `/api/history?wallet=&limit=` | Game history |

### Game Rules

- **Players:** 3 (1 Landlord + 2 Farmers)
- **Deck:** 54 cards (52 standard + 2 jokers)
- **Objective:** First to play all cards wins
- **Bidding:** Players bid to become Landlord (gets 3 bonus cards)
- **Settlement:** Landlord wins → farmers pay stake × multiplier; Farmers win → landlord pays both × multiplier

---

## 中文

### 项目简介

链上斗地主是基于 Solana 区块链的去中心化斗地主游戏。游戏状态通过 Anchor 合约存储在链上，中继服务器负责实时事件广播。玩家质押代币进入房间，所有胜负由智能合约自动结算，无需信任第三方。项目内置完整的代币经济模型，包含奖励池、排行榜和反作弊系统。

### 技术栈

| 组件 | 技术 |
|------|------|
| 智能合约 | Solana / Anchor (Rust)，Token-2022，SPL Token |
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 |
| 游戏引擎 | 纯 TypeScript（Jest 测试，覆盖率 97%+）|
| 中继服务器 | Express 5 + WebSocket + Redis + PostgreSQL |
| 钱包 | Solana Wallet Adapter |
| 基础设施 | Docker Compose（PostgreSQL + Redis）|

### 核心功能

- **链上结算** — 智能合约托管质押金，自动原子性结算，链上扣取 2% 手续费
- **实时多人对战** — WebSocket 中继服务器广播游戏事件
- **托管机器人** — 练习模式支持单人 vs AI 对战
- **多档位房间** — 四个等级（小/中/大/鲸鱼），对应不同质押门槛
- **倍率系统** — 炸弹×2、春天×2、反春天×2、加倍×2，结算时原子性应用
- **代币经济** — 7 天奖励周期、加权排行榜评分、反女巫攻击保护
- **历史记录** — PostgreSQL 完整记录每局数据
- **端到端测试** — Playwright 覆盖完整游戏流程

---

### 代币经济模型

代币经济模型的设计目标是激励真实游戏行为，同时抑制刷分和作弊。整个经济系统运行在链下（无需修改已部署的合约），基于链上结算事件的数据驱动。

#### 手续费流向

```
玩家质押 → 链上托管 → 结算
                       │
                       ├── 2% 手续费（链上固定，合约内扣除）
                       │     ├── 80% → 奖励池
                       │     └── 20% → 国库（协议收入）
                       │
                       └── 98% → 赢家/输家分配
```

#### 7 天奖励周期

手续费在 **7 天滚动周期** 内持续累积到奖励池。周期结束后，奖励池按照排行榜排名分配给顶尖玩家。

#### 排行榜评分机制

玩家评分采用 **加权公式**，平衡游戏量、技术水平和娱乐价值：

| 因子 | 权重 | 设计意图 |
|------|------|----------|
| 对局数 | 40% | 奖励活跃参与 |
| 胜率 | 30% | 奖励技术和稳定性 |
| 精彩操作 | 30% | 奖励精彩表现（炸弹、火箭、春天） |

**精彩操作**包括：炸弹、火箭（大小王）、春天（地主一手出完）、反春天（农民一手出完）。

各因子对周期内最高值归一化后加权求和：

```
评分 = 0.4 × (对局数 / 最高对局数) + 0.3 × 胜率 + 0.3 × (精彩数 / 最高精彩数)
```

#### 反女巫攻击（Anti-Sybil）

为防止刷分和利用系统漏洞，每局对局的奖励权重会经过多重质量信号调整：

| 检查项 | 机制 | 效果 |
|--------|------|------|
| **时长权重** | < 30s → 权重 0；30–60s → 0.2；1–2min → 0.5；2–5min → 0.8；≥5min → 1.0 | 惩罚速通刷分 |
| **冷启动因子** | 新账户：权重 = min(对局数 / 10, 1.0) | 防止女巫新号批量刷分 |
| **IP 冲突** | 标记同一 IP 下多个玩家的对局 | 检测自我对战 |
| **共谋检测** | 两个钱包 7 天内同房间出现 ≥5 次 → 标记，奖励权重归零 | 检测协同刷分 |

#### 奖励领取

玩家在周期结束后可领取奖励。领取时通过中继钱包从国库 ATA 向玩家钱包发起链上 SPL 代币转账。最低领取门槛：1,000 lamport（防止粉尘交易）。

---

### 开发环境搭建

```bash
# 1. 克隆项目
git clone https://github.com/jamese5095/doudizhu-solana.git
cd doudizhu-solana

# 2. 安装依赖
npm install

# 3. 启动基础设施
docker-compose up -d

# 4. 配置环境变量
cp .env.example .env.local

# 5. 构建并部署 Anchor 程序
cd programs/doudizhu && anchor build && anchor deploy

# 6. 同步 IDL
cp target/idl/programs_doudizhu.json ../../packages/frontend/lib/idl.json

# 7. 启动中继服务器
cd ../../server && npm run dev

# 8. 启动前端
cd packages/frontend && npm run dev
```

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reward-pool` | 当前奖励周期状态 |
| GET | `/api/leaderboard?limit=&offset=` | 排行榜 |
| GET | `/api/reward-pool/my?wallet=` | 我的奖励 |
| POST | `/api/reward-pool/claim` | 领取奖励 |
| GET | `/api/reward-pool/history?wallet=` | 领取历史 |
| GET | `/api/history?wallet=&limit=` | 对局历史 |

### 游戏规则

- **玩家：** 3 人（1 地主 + 2 农民）
- **牌堆：** 54 张（52 张标准牌 + 2 张王牌）
- **目标：** 率先出完手中所有牌
- **叫地主：** 玩家竞价成为地主（获得 3 张底牌）
- **结算：** 地主赢 → 农民赔付质押 × 倍率；农民赢 → 地主赔付双方 × 倍率

---

## License

ISC
