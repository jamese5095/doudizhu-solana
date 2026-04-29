-- game_records：每局结算后由服务器写入，供前端历史记录接口查询
-- 执行方式：psql $DATABASE_URL -f src/history/schema.sql

CREATE TABLE IF NOT EXISTS game_records (
  id               SERIAL       PRIMARY KEY,
  room_id          VARCHAR(32)  NOT NULL,
  tx_signature     VARCHAR(88)  NOT NULL UNIQUE,
  winner_id        VARCHAR(44)  NOT NULL,
  bet_tier         SMALLINT     NOT NULL,   -- BetTier: Small=0 Medium=1 Large=2 Whale=3
  final_multiplier SMALLINT     NOT NULL,
  settled_at       BIGINT       NOT NULL,   -- Unix 时间戳（秒）
  payouts          JSONB        NOT NULL    -- [{ playerId: string, delta: string }]
);

-- GIN 索引支持 payouts @> '[{"playerId":"..."}]' 查询
CREATE INDEX IF NOT EXISTS idx_game_records_player
  ON game_records USING GIN (payouts);

-- ─── 经济模型扩展字段 ──────────────────────────────────────────────────────────

ALTER TABLE game_records ADD COLUMN IF NOT EXISTS duration_secs    SMALLINT;
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS quality_weight   REAL DEFAULT 1.0;
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS highlight_count  SMALLINT DEFAULT 0;
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS ip_conflict      BOOLEAN DEFAULT FALSE;

-- ─── 奖励池周期表 ──────────────────────────────────────────────────────────────
-- 每 7 天一个周期，记录累计手续费和分配状态

CREATE TABLE IF NOT EXISTS reward_cycles (
  id             SERIAL       PRIMARY KEY,
  cycle_start    BIGINT       NOT NULL,   -- 周期起始 Unix 时间戳（秒）
  cycle_end      BIGINT       NOT NULL,   -- 周期结束 Unix 时间戳（秒）
  total_fees     BIGINT       NOT NULL DEFAULT 0,  -- 本周期累计手续费（lamport）
  pool_amount    BIGINT       NOT NULL DEFAULT 0,  -- 进入奖励池金额 = total_fees × 0.8
  distributed    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cycle_start UNIQUE (cycle_start)
);

-- ─── 排行榜分数表 ──────────────────────────────────────────────────────────────
-- 每个周期每个钱包一行，累计统计

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  id             SERIAL       PRIMARY KEY,
  cycle_id       INTEGER      NOT NULL REFERENCES reward_cycles(id),
  wallet         VARCHAR(44)  NOT NULL,
  games_played   INTEGER      NOT NULL DEFAULT 0,
  games_won      INTEGER      NOT NULL DEFAULT 0,
  highlights     INTEGER      NOT NULL DEFAULT 0,   -- 炸弹+火箭+春天 总计数
  weighted_score REAL         NOT NULL DEFAULT 0.0,  -- 综合加权分数
  reward_amount  BIGINT       NOT NULL DEFAULT 0,    -- 分配到的奖励（lamport）
  CONSTRAINT uq_cycle_wallet UNIQUE (cycle_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_cycle_score
  ON leaderboard_scores (cycle_id, weighted_score DESC);

-- ─── 奖励领取记录 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reward_claims (
  id             SERIAL       PRIMARY KEY,
  cycle_id       INTEGER      NOT NULL REFERENCES reward_cycles(id),
  wallet         VARCHAR(44)  NOT NULL,
  amount         BIGINT       NOT NULL,
  tx_signature   VARCHAR(88)  NOT NULL UNIQUE,
  claimed_at     BIGINT       NOT NULL,  -- Unix 时间戳（秒）
  CONSTRAINT uq_claim_cycle_wallet UNIQUE (cycle_id, wallet)
);
