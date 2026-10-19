-- 架构与功能扩展迁移
-- 1) 记录级同步：tombstone 删除（deleted 标记）+ 增量游标（updatedAt 已存在）
-- 2) 信用卡积分 / 年费追踪字段
-- 3) Web Push 订阅存储（还款提醒）

ALTER TABLE cards ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cards ADD COLUMN points INTEGER;
ALTER TABLE cards ADD COLUMN annual_fee INTEGER;
ALTER TABLE cards ADD COLUMN annual_fee_date TEXT;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
