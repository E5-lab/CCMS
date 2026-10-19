#!/usr/bin/env bash
# CCMS D1 一键初始化：创建数据库 → 部署（建表由 Worker 首次访问自动完成）
#
# 绑定写在 wrangler.toml 的 [[d1_databases]]，部署时自动带上。
# 之后无论是 `npm run deploy` 还是 Cloudflare Git 自动部署，D1 绑定都会自动保留，
# 不再需要每次重新部署后到后台手动绑定。
#
# 前置条件：
#   1. 已登录 Cloudflare：wrangler login （或设置 CLOUDFLARE_API_TOKEN 环境变量）
#   2. 已安装依赖：npm install （会装 wrangler）
#
# 用法：npm run setup:d1
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> CCMS D1 一键初始化"

WRANGLER="npx wrangler"

# 1. 复用已有 ID（.env 已被 .gitignore 忽略，不会进仓库）
if [ -f .env ] && grep -q '^CCMS_D1_ID=' .env; then
  echo "==> 检测到 .env 中已有 CCMS_D1_ID，复用现有数据库"
  set -a; source .env; set +a
fi

if [ -z "${CCMS_D1_ID:-}" ]; then
  echo "==> 创建 D1 数据库 ccms ..."
  OUT=$($WRANGLER d1 create ccms --output-format json)
  CCMS_D1_ID=$(printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const db=j.d1_databases&&j.d1_databases[0];if(!db||!db.uuid){console.error('未能解析数据库 ID：\n'+s);process.exit(1)}console.log(db.uuid)})")
  echo "==> 数据库 ID: $CCMS_D1_ID"
  # 写入 .env（保留其它已有内容）
  touch .env
  grep -v '^CCMS_D1_ID=' .env > .env.tmp || true
  printf 'CCMS_D1_ID=%s\n' "$CCMS_D1_ID" >> .env.tmp
  mv .env.tmp .env
fi

# 2. 部署（绑定随 wrangler.toml 生效，自动带上 D1）
echo "==> 部署 Worker（D1 绑定自动带上）..."
$WRANGLER deploy

echo ""
echo "✅ 完成！"
echo "   • D1 绑定已写入 wrangler.toml，后续 'npm run deploy' / git push 自动保留，无需再手动绑定。"
echo "   • 应用首次访问时会自动建表（CREATE TABLE IF NOT EXISTS），无需手动执行任何 SQL。"
echo "   • 若使用 Cloudflare Git 自动部署，请在后台 Workers→ccms→Settings→Variables 中添加变量："
echo "       CCMS_D1_ID = $CCMS_D1_ID"
echo "     （这样构建环境的 wrangler.toml 也能解析到数据库 ID）"
echo "   • 本地开发：npm run dev"
echo "   • 仅本地使用、不启用云端：把 wrangler.toml 中 [[d1_databases]] 整段注释掉即可。"
