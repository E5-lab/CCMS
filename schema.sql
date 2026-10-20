-- CCMS D1 完整表结构（合并原 0001/0002/0003）
-- 说明：线上部署后 Worker 会在首次访问时通过 CREATE TABLE IF NOT EXISTS 自动建表，
-- 本文件仅供本地查看 / 手动排查 / 参考，无需手动执行。
-- 字段统一使用驼峰，与前端对象结构一致，省去映射层。
-- 注意：`limit` 是 SQL 保留字，需用反引号括起来。

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  nickname   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  bank        TEXT,
  last4       TEXT,
  billingDay  INTEGER,
  dueDay      INTEGER,
  gracePeriod INTEGER,
  `limit`     REAL,
  color       TEXT,
  image       TEXT,
  closed      INTEGER NOT NULL DEFAULT 0,
  closedAt    TEXT,
  points      INTEGER,
  annual_fee  INTEGER,
  annual_fee_date TEXT,
  annual_fee_type   TEXT DEFAULT 'amount',
  annual_fee_swipe  INTEGER,
  annual_fee_points INTEGER,
  deleted     INTEGER NOT NULL DEFAULT 0,
  updatedAt   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id        TEXT PRIMARY KEY,
  owner     TEXT NOT NULL DEFAULT '',
  cardId    TEXT NOT NULL,
  period    TEXT NOT NULL,
  statement REAL,
  paid      REAL,
  status    TEXT,
  dueDate   TEXT,
  note      TEXT,
  deleted   INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner);
CREATE INDEX IF NOT EXISTS idx_bills_owner ON bills(owner);
CREATE INDEX IF NOT EXISTS idx_bills_card  ON bills(cardId);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
