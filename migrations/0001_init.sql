-- CCMS D1 初始化脚本
-- 字段统一使用驼峰，与前端对象结构一致，省去映射层。
-- 注意：`limit` 是 SQL 保留字，需用反引号括起来。

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
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner);
CREATE INDEX IF NOT EXISTS idx_bills_owner ON bills(owner);
CREATE INDEX IF NOT EXISTS idx_bills_card  ON bills(cardId);
