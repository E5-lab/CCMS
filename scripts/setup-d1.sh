#!/usr/bin/env bash
# CCMS D1 一键初始化：创建数据库 → 写入绑定 → 部署（建表由 Worker 首次访问自动完成）
#
# 绑定由本脚本写入本地 wrangler.toml（不入库）；之后 `npm run deploy` 自动带上。
# 注意：若用 Cloudflare Git 自动构建部署，本地写入不会同步到云端，
#       请在后台一次性手动绑定（见 README「云端同步」一节）。
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

# 2. 把 D1 绑定（真实 ID）追加进 wrangler.toml（幂等：已存在则跳过）
#    注：wrangler 不支持 toml 里的 ${VAR} 替换，且仓库中默认不放绑定（避免 Git 构建部署报 10021），
#    所以由本脚本在部署前写入真实 database_id。
if grep -q '^\[\[d1_databases\]\]' wrangler.toml; then
  echo "==> wrangler.toml 已含 D1 绑定，跳过写入"
else
  echo "==> 写入 D1 绑定到 wrangler.toml ..."
  cat >> wrangler.toml <<TOML

[[d1_databases]]
binding = "DB"
database_name = "ccms"
database_id = "$CCMS_D1_ID"
TOML
fi

# 3. 部署（绑定随 wrangler.toml 生效，自动带上 D1）
echo "==> 部署 Worker（D1 绑定自动带上）..."
$WRANGLER deploy

echo ""
echo "✅ 完成！"
echo "   • D1 绑定已写入本地 wrangler.toml（不入库），后续 'npm run deploy' 自动保留。"
echo "   • 应用首次访问时会自动建表（CREATE TABLE IF NOT EXISTS），无需手动执行任何 SQL。"
echo "   • 若使用 Cloudflare Git 自动部署：本地写入的绑定不会同步到云端构建，"
echo "     请在后台一次性手动绑定：Workers→ccms→Settings→Bindings→Add→D1 database"
echo "       Variable name: DB    D1 database: ccms (ID: $CCMS_D1_ID)"
echo "   • 本地开发：npm run dev"
