# CCMS · 信用卡账单管理

> 一个用于记录多张信用卡**月度账单、年度账单、历年账单汇总**的管理工具。
> 前端为零依赖原生单页应用；数据存储支持**本地（localStorage）**与**云端（Cloudflare D1）**双模式。

## 功能

- 💳 **信用卡管理**：增删改多张信用卡（银行、卡号后 4 位、账单日、还款日、免息期、信用额度、颜色标签）。
- 🖼️ **卡面图片**：可上传卡面图片，卡片优先展示图片，无图回退到颜色，便于区分多张卡、更美观。
- 📅 **月度账单**：按年/月查看各卡本期账单、已还、待还、还款日、状态，自动汇总；**还款日可按卡片设置自动生成**（可手动覆盖）。
- 🗄️ **已注销模块**：独立导航保留已注销信用卡与玩卡经历，可随时恢复或彻底删除。
- 📊 **年度汇总**：各卡年度合计 + 全年月度走势（SVG 图表）。
- 🗂️ **历年汇总**：跨年总览与对比。
- 🧭 **概览面板**：有效卡数、本月账单、最近待还、总额度速览。
- ☁️ **多设备同步**：在「设置」中开启云端同步（Cloudflare D1），多设备使用同一「同步密钥」即可共享数据。
- 🧪 内置「导入示例数据」便于快速体验。

## 目录结构

```
.
├── public/            # 前端单页应用（零依赖，原生 HTML/CSS/JS）
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   └── worker.js      # Cloudflare Worker 入口（静态托管 + /api 同步接口）
├── migrations/
│   └── 0001_init.sql  # D1 建表脚本
├── wrangler.toml      # Cloudflare Workers 配置（含 D1 绑定）
└── package.json
```

## 本地预览

```bash
npm install
npm run dev        # 启动 wrangler dev，默认 http://localhost:8787
```

也可直接用浏览器打开 `public/index.html` 体验（默认本地存储模式）。

## 部署到 Cloudflare Workers（含 D1 云端同步）

```bash
npm install

# 1) 创建 D1 数据库，并把输出的 id 填入 wrangler.toml 的 database_id
npx wrangler d1 create ccms

# 2) 初始化数据库表（生产环境）
npx wrangler d1 migrations apply ccms --remote

# 3) 部署
npm run deploy
```

部署后访问分配的 `*.workers.dev` 域名，进入「设置」开启云端同步并设置一个同步密钥即可多设备共享。

> 本地开发如需使用 D1：`npx wrangler d1 migrations apply ccms --local` 后 `npm run dev`（默认本地数据库）。

## 数据模型

- **信用卡** `{ id, name, bank, last4, billingDay, dueDay, gracePeriod, limit, color, image, closed, closedAt, updatedAt }`
  - `closed`：是否已注销；`image`：卡面图片（data URL）；`gracePeriod`：免息期天数。
- **月度账单** `{ id, cardId, period: "YYYY-MM", statement, paid, status, dueDate, note, updatedAt }`
  - `status`：`unpaid`(未还) / `paid`(已还) / `min`(最低还款)

云端同步时，两张表均增加 `owner` 字段（= 同步密钥），并按 `updatedAt` 最后写入优先。

## 安全说明

- 云端同步以「同步密钥」作为数据命名空间，**并非正式鉴权**。多设备请使用同一非敏感密钥。
- 生产环境建议替换为正式用户系统（JWT / 登录），卡面图片建议改用 Cloudflare R2 对象存储。

## 后续演进

1. 正式用户系统与鉴权（替代同步密钥）。
2. 账单分类、消费明细、还款提醒、导出 CSV / 对接银行账单导入。
3. 卡面图片迁移到 R2，减轻 D1 行大小。

---

仓库：https://github.com/E5-lab/CCMS
