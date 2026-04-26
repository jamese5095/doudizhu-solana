# 链上斗地主 / Doudizhu on Solana

> A fully on-chain Dou Dizhu (斗地主) poker game powered by Solana blockchain with real-time multiplayer, bot players, and automated settlement.

**语言 / Language:** [English](#english) | [中文](#中文)

---

## English

### Overview

Doudizhu on Solana is a decentralized, trustless implementation of the classic Chinese card game "Dou Dizhu" (斗地主). Game state is stored on-chain via Solana programs (Anchor), while a relay server handles real-time event broadcasting. Players stake tokens to enter rooms, and all winnings/losings are settled automatically by the smart contract.

### Architecture

```
doudizhu-solana/
├── programs/
│   └── doudizhu/          # Anchor/Solana smart contract
├── packages/
│   ├── types/              # Shared TypeScript interfaces (zero-dependency)
│   ├── game-engine/        # Pure game logic (no I/O, no Solana deps)
│   └── frontend/           # Next.js web UI (wallet connect + game table)
└── server/
    └── src/index.ts        # Relay server (Express + WebSocket)
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Smart Contract | Solana / Anchor (Rust) |
| Frontend | Next.js 16 + React 19 + Tailwind CSS 4 |
| Game Engine | Pure TypeScript (tested with Jest, 97%+ coverage) |
| Relay Server | Express 5 + WebSocket + Redis + PostgreSQL |
| Wallet | Solana Wallet Adapter |

### Key Features

- **On-chain settlement** — No trusted third party; the Anchor program escrows stakes and settles automatically
- **Real-time multiplayer** — WebSocket relay server broadcasts game events to all players in a room
- **Bot players** —托管机器人 (Managed bots) for solo practice mode, with basic strategy
- **Multiple bet tiers** — 4 room levels (Small / Medium / Large / Whale) with different stake requirements
- **Multiplier system** — Bomb ×2, Spring (春天) ×2, Double (加倍) ×2, etc., all applied atomically in settlement
- **Game history** — PostgreSQL records every completed game with full state
- **E2E testing** — Playwright test suite covering full game flow

### Development Setup

**Prerequisites:** Node.js 18+, Rust + Solana toolchain, Docker (for postgres + redis)

```bash
# 1. Clone
git clone https://github.com/<your-username>/doudizhu-solana.git
cd doudizhu-solana

# 2. Install all workspace dependencies
npm install

# 3. Start infrastructure (postgres + redis)
docker-compose up -d

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local with your Solana devnet wallet and program ID

# 5. Build the Anchor program
cd programs/doudizhu
anchor build

# 6. Deploy to devnet (update Program ID in Anchor config first)
anchor deploy

# 7. Sync IDL to frontend
cp programs/doudizhu/target/idl/programs_doudizhu.json \
   packages/frontend/lib/idl.json

# 8. Start relay server
cd ../server
npm run dev

# 9. Start frontend (new terminal)
cd packages/frontend
npm run dev
```

**Frontend:** http://localhost:3000
**Relay API:** http://localhost:8080

### Environment Variables

| Variable | Description |
|----------|-------------|
| `RPC_URL` | Solana RPC endpoint (devnet recommended for dev) |
| `PROGRAM_ID` | Deployed Anchor program ID |
| `RELAY_WALLET` | Keypair JSON for the relay wallet (escrow operator) |
| `MEME_MINT` | SPL Token mint for the in-game stake token |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

### Testing

```bash
# Game engine unit tests
cd packages/game-engine
npm test

# Anchor program tests
cd programs/doudizhu
anchor test

# E2E (requires TEST_WALLET_0/1/2 env vars with funded devnet wallets)
cd packages/frontend
npx playwright test
```

### Game Rules (Brief)

- **Players:** 3 (Landlord + 2 Farmers)
- **Deck:** 54 cards (52 + 2 jokers)
- **Card ranks:** 3–10, J, Q, K, A, 2, 小王(16), 大王(17)
- **Objective:** Be the first to play all your cards
- **Betting:** Players bid to become Landlord; stakes multiply on bombs, springs, and doubles
- **Settlement:** Landlord wins → farmers lose stake × multiplier; Farmers win → landlord pays both × multiplier

### Known Limitations (托管机器人)

- Bots never respond to complex patterns (straights, planes); they always pass in those cases
- Bots always play their smallest non-bomb card on first move (not optimal)

---

## 中文

### 项目简介

链上斗地主是基于 Solana 区块链的去中心化斗地主游戏。游戏状态通过 Anchor 合约存储在链上，中继服务器负责实时事件广播。玩家质押代币进入房间，所有胜负由智能合约自动结算，无需信任任何第三方。

### 项目结构

```
doudizhu-solana/
├── programs/
│   └── doudizhu/          # Anchor/Solana 智能合约
├── packages/
│   ├── types/              # 共享 TypeScript 类型定义（零依赖）
│   ├── game-engine/        # 纯游戏逻辑（无 I/O，无 Solana 依赖）
│   └── frontend/          # Next.js 网页界面（钱包连接 + 牌桌）
└── server/
    └── src/index.ts        # 中继服务器（Express + WebSocket）
```

### 技术栈

| 组件 | 技术 |
|------|------|
| 智能合约 | Solana / Anchor (Rust) |
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 |
| 游戏引擎 | 纯 TypeScript（Jest 测试，覆盖率 97%+）|
| 中继服务器 | Express 5 + WebSocket + Redis + PostgreSQL |
| 钱包 | Solana Wallet Adapter |

### 核心功能

- **链上结算** — 智能合约托管质押金，自动结算，无需第三方信任
- **实时多人对战** — WebSocket 中继服务器向房间内所有玩家广播游戏事件
- **托管机器人** — 练习模式支持单人 vs 两个机器人对战
- **多倍率房间** — 四个等级（小/中/大/鲸鱼），对应不同质押门槛
- **倍率系统** — 炸弹×2、春天×2、加倍×2 等，所有倍率在结算时原子性应用
- **历史记录** — PostgreSQL 记录每局完整状态
- **端到端测试** — Playwright 测试套件覆盖完整游戏流程

### 开发环境搭建

**环境要求：** Node.js 18+、Rust + Solana 工具链、Docker（postgres + redis）

```bash
# 1. 克隆项目
git clone https://github.com/<your-username>/doudizhu-solana.git
cd doudizhu-solana

# 2. 安装所有工作区依赖
npm install

# 3. 启动基础设施（postgres + redis）
docker-compose up -d

# 4. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入你的 Solana devnet 钱包和程序 ID

# 5. 构建 Anchor 程序
cd programs/doudizhu
anchor build

# 6. 部署到 devnet（先在 Anchor 配置中更新 Program ID）
anchor deploy

# 7. 同步 IDL 到前端
cp programs/doudizhu/target/idl/programs_doudizhu.json \
   packages/frontend/lib/idl.json

# 8. 启动中继服务器
cd ../server
npm run dev

# 9. 启动前端（新终端窗口）
cd packages/frontend
npm run dev
```

**前端地址：** http://localhost:3000
**中继 API：** http://localhost:8080

### 环境变量

| 变量 | 说明 |
|------|------|
| `RPC_URL` | Solana RPC 节点（开发推荐 devnet） |
| `PROGRAM_ID` | 已部署的 Anchor 程序 ID |
| `RELAY_WALLET` | 中继钱包的 Keypair JSON（托管操作者）|
| `MEME_MINT` | 游戏质押代币的 SPL Token Mint |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `REDIS_URL` | Redis 连接字符串 |

### 测试

```bash
# 游戏引擎单元测试
cd packages/game-engine
npm test

# Anchor 程序测试
cd programs/doudizhu
anchor test

# E2E 测试（需要 TEST_WALLET_0/1/2 环境变量，预充 0.1 SOL + 5000 MEME）
cd packages/frontend
npx playwright test
```

### 游戏规则（简述）

- **玩家：** 3人（地主 + 2 农民）
- **牌堆：** 54 张（52 张标准牌 + 2 张王牌）
- **牌面值：** 3–10, J, Q, K, A, 2, 小王(16), 大王(17)
- **目标：** 率先出完手中所有牌
- **叫地主：** 玩家竞价成为地主，决定倍率
- **结算：** 地主赢 → 农民损失质押 × 倍率；农民赢 → 地主赔付双方 × 倍率

### 托管机器人已知局限

- 复杂牌型（顺子/飞机）不会应战，永远 pass
- 首出轮只出最小非炸弹单张（非最优策略）

---

## License / 许可证

ISC
