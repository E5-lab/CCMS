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
- 💾 **跨设备 / 备份**：「设置」中一键导出 / 导入 JSON 备份，无需任何后端即可在多设备间迁移数据。
- ☁️ **（可选）云端实时同步**：进阶可在 Cloudflare 后台绑定 D1，开启「云端同步」，多设备用同一密钥自动共享。
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
├── wrangler.toml      # Cloudflare Workers 配置（D1 绑定在后台手动添加）
└── package.json
```

## 本地预览

```bash
npm install
npm run dev        # 启动 wrangler dev，默认 http://localhost:8787
```

也可直接用浏览器打开 `public/index.html` 体验（默认本地存储模式）。

## 部署到 Cloudflare（傻瓜式，无需命令行 / 无需凭证）

CCMS 是纯静态站点，推荐用 **Cloudflare Pages** 一键部署，**完全不需要装任何软件、不需要命令行、不需要 Cloudflare 凭证**。

### 方式一：连 GitHub 自动部署（推荐，改动自动上线）
1. 登录 Cloudflare 后台 → 左侧 **Workers & Pages** → **Create** → 选 **Pages** → **Connect to Git**。
2. 授权并选择 `E5-lab/CCMS` 仓库。
3. 构建设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**`public`**
4. 点 **Save and Deploy**，几十秒后拿到 `*.pages.dev` 域名，直接访问即可用。

之后每次 `git push` 到 GitHub，Cloudflare 会自动重新部署。

> 若你用的是 **Workers（Git 集成构建）** 部署：仓库的 `wrangler.toml` 已配置 `not_found_handling = "single-page-application"`（SPA 回退），部署即用，**无需任何额外文件**。

### 方式二：直接上传文件夹（连 GitHub 都不要）
1. Cloudflare 后台 → **Workers & Pages** → **Create** → **Pages** → **Upload assets**。
2. 把本仓库的 `public` 文件夹拖进去，起个名字（如 `ccms`），点部署。
3. 完成，拿到域名直接用。

> 两种方式部署后，应用默认使用**本地存储**，开箱即用。无需配置 D1、无需任何后端。

### （可选进阶）多设备云端同步 —— Cloudflare D1
如果你希望多设备自动实时同步（而不是用下面的导出/导入文件），可在 Cloudflare 后台手动绑定 D1（仍无需本地凭证）：
1. 后台 → **Storage & Databases** → **D1 SQL Engine** → Create，数据库名 `ccms`。
2. 进入该数据库 **Console**，粘贴执行 `migrations/0001_init.sql` 的全部内容建表。
3. 后台 → **Workers & Pages** → `ccms` → **Settings** → **Bindings** → Add binding：
   Type 选 **D1 Database**，Variable name 填 **`DB`**，选 `ccms`，保存。
4. 访问站点，「设置 → 云端同步」填同一同步密钥即可多设备共享。
5. 未绑定 D1 时调用同步会提示「云端存储未启用」，不影响本地模式。

> 本地开发如需用 D1：取消 `wrangler.toml` 中 `[[d1_databases]]` 注释并填 `database_id`，再 `npx wrangler d1 migrations apply ccms --local` 后 `npm run dev`。

## 跨设备（最简单，无需云端）
「设置 → 备份与跨设备迁移」可一键**导出备份 JSON**；换设备后在同页面**导入备份**即可恢复全部数据。这是最省事的跨设备方式，不依赖任何后端。

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
