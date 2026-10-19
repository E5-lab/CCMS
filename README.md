# CCMS · 信用卡账单管理

> 一个用于记录多张信用卡**月度账单、年度账单、历年账单汇总**的管理工具。
> 前端为零依赖原生单页应用（按职责拆分为多个经典脚本）；数据存储支持**本地（localStorage）**与**云端账户（Cloudflare D1 + 邮箱密码鉴权）**双模式。

## 功能

- 💳 **信用卡管理**：增删改多张信用卡（银行、卡号后 4 位、账单日、还款日、免息期、信用额度、颜色标签）。
- 🖼️ **卡面图片**：支持**本地上传**或**图床链接（URL）**两种方式（二选一），卡片优先展示图片，无图回退到颜色，便于区分多张卡。
- 📅 **月度账单**：按年/月查看各卡本期账单、已还、待还、还款日、状态，自动汇总；**还款日可按卡片设置自动生成**（可手动覆盖）。
- 🗄️ **已注销模块**：独立导航保留已注销信用卡，可随时恢复或彻底删除。
- 📊 **年度汇总**：各卡年度合计 + 全年月度走势（SVG 图表）。
- 🗂️ **历年汇总**：跨年总览与对比。
- 🧭 **概览面板**：有效卡数、本月账单、最近待还、总额度速览。
- 💾 **跨设备 / 备份**：「设置」中一键导出 / 导入 JSON 备份，无需任何后端即可在多设备间迁移数据。
- ☁️ **（可选）云端账户同步**：在 Cloudflare 后台绑定 D1 后，注册/登录真实账号；**登录即拉取云端最新数据，本地任何改动立即上传，窗口聚焦/重新可见时自动同步其它设备的改动**（邮箱+密码，按账号隔离；记录级最后写入优先 + 墓碑删除 + 增量同步 + 离线写队列）。
- 🔔 **主动还款提醒（Web Push）**：Worker 每日 09:00 扫描「3 天内到期且未还」的账单，通过浏览器推送提醒（需配置 VAPID 密钥并授予通知权限）。
- 🏷️ **积分 / 年费追踪**：卡片可记录积分余额、年费（元）、年费日期。
- 📥 **CSV 账单导入**：设置页按模板批量导入银行账单，自动匹配或新建卡片，导入前可预览校验。
- 📲 **PWA 可安装**：支持作为独立应用安装到手机/桌面（含离线访问）。

## 目录结构

```
.
├── public/                  # 前端单页应用（零依赖，原生 HTML/CSS/JS）
│   ├── index.html           # 入口，按依赖顺序加载下列脚本
│   ├── styles.css
│   ├── manifest.webmanifest # PWA 清单
│   ├── sw.js                # Service Worker（外壳缓存 + 离线）
│   ├── icon-*.png           # 应用图标（gen_icons.py 生成）
│   └── js/                  # 前端按职责拆分的经典脚本（共享全局作用域）
│       ├── util.js          # 纯工具函数（格式化、安全清洗、CSV 解析、图表）
│       ├── api.js           # 接口层：Auth（鉴权）+ Sync（增量同步）
│       ├── store.js         # 数据层：本地缓存 + 云端同步 + 离线写队列
│       ├── modals.js        # 弹窗：信用卡 / 账单 / CSV 导入 + 持久化提交
│       ├── ui.js            # 视图渲染与事件绑定
│       └── app.js           # 入口：全局状态 + 路由 + 初始化 + 自动同步
├── src/
│   └── worker.js            # Cloudflare Worker 入口（静态托管 + /api 接口 + Cron 提醒 + 自动建表）
├── schema.sql               # D1 完整表结构（参考/本地用；线上由 Worker 自动建表）
├── wrangler.toml            # Cloudflare Workers 配置（D1 绑定、Cron、静态资源）
├── scripts/setup-d1.sh      # 一键：创建 D1 → 部署（建表由 Worker 自动完成）
├── package.json
└── gen_icons.py             # 纯 Python 生成 PWA 图标（无第三方依赖）
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

### （可选进阶）多设备云端同步 —— Cloudflare D1 + 账号鉴权

> 仓库中**不包含** D1 绑定配置：wrangler 不支持在 `wrangler.toml` 里做 `${VAR}` 环境变量替换，
> 写占位符会导致 Cloudflare Git 构建部署直接失败（code 10021）。因此绑定在你自己的 Cloudflare
> 后台完成**一次**即可，之后永久保留，后续每次 `git push` 自动部署都不会丢失。

**启用云端同步（后台手动绑定，无需任何凭证/命令行）：**

1. Cloudflare 后台 → **存储和数据 → D1** → **创建数据库**，名字填 `ccms`（记下页面显示的数据库 ID）。
2. **Workers & Pages → ccms → 设置(Settings) → 绑定(Bindings) → 添加 → D1 数据库**：
   - 变量名称（Variable name）：`DB`
   - D1 数据库：选择 `ccms`
3. 保存即可，**无需重新部署**。访问站点时 Worker 会在首次请求中用 `CREATE TABLE IF NOT EXISTS` 自动建全部表。

部署完成后访问站点，「设置 → 云端账户」用**邮箱+密码注册/登录**即可，本地数据会自动上传，多设备用同一账号自动同步。

**备选：本地 CLI 一键部署**（不依赖 Git 构建，需要 Cloudflare 凭证）：

```bash
npm install
npx wrangler login        # 一次性登录 Cloudflare（或设置 CLOUDFLARE_API_TOKEN）
npm run setup:d1          # 创建 D1 → 把绑定写入本地 wrangler.toml → 部署
```

> **关于建表**：Worker 在首次访问（注册/登录或任意同步请求）时，会用 `CREATE TABLE IF NOT EXISTS` **自动创建全部表**，因此你**不需要**在 D1 控制台手动粘贴任何 SQL（`schema.sql` 仅供参考）。

## 跨设备（最简单，无需云端）
「设置 → 数据管理」可一键**导出备份 JSON**；换设备后在同页面**导入备份**即可恢复全部数据。这是最省事的跨设备方式，不依赖任何后端。导入会经过 `validateBackup` 校验与卡面 URL 白名单清洗。

## PWA 安装（作为独立应用）
本项目包含 `manifest.webmanifest` 与 `sw.js`（`public/` 下），部署后即为可安装 PWA：
- 浏览器地址栏会出现「安装」图标；手机浏览器「添加到主屏幕」即可像原生 App 一样打开。
- 支持离线访问（应用外壳缓存），API 请求始终走网络保证数据实时。
- 图标由 `gen_icons.py` 生成（纯 Python，无需第三方库），如需替换品牌色/图形可改后重跑。

## 数据模型

- **信用卡** `{ id, name, bank, last4, billingDay, dueDay, gracePeriod, limit, color, image, closed, closedAt, points, annual_fee, annual_fee_date, updatedAt }`
  - `closed`：是否已注销；`image`：卡面图片（data URL 或 https 链接）；`gracePeriod`：免息期天数。
- **月度账单** `{ id, cardId, period: "YYYY-MM", statement, paid, status, dueDate, note, updatedAt }`
  - `status`：`unpaid`(未还) / `paid`(已还) / `min`(最低还款)
- **用户系统**：`users(id, email, pass_hash, salt, created_at)`、`sessions(token, user_id, expires_at)`
- **推送订阅**：`push_subscriptions(id, user_id, endpoint, p256dh, auth, created_at, updated_at)`

云端模式下，业务表均增加 `owner` 字段（= 用户 id），数据按账号隔离；同步采用记录级 **Last-Write-Wins**（`updatedAt` 比较）+ **墓碑删除**（`deleted` 标记）+ **增量游标**（`since`）。

## 安全说明

- **账号鉴权**：密码使用 **PBKDF2**（10 万次迭代）+ 随机盐哈希存储，服务端不留存明文；会话令牌存 D1，30 天有效期；数据按 `user_id` 隔离。
- **卡面图片 XSS 防护**：渲染时仅允许 `data:image` 与 `https` 链接（`safeImage` / `imgCss` 白名单），其余一律丢弃，杜绝 CSS 注入。
- **备份导入校验**：`validateBackup` 校验结构与类型，并对卡面 URL 做同样白名单清洗。
- 纯前端无后端依赖时（本地存储模式）数据仅存于浏览器；如需更强保护，可启用云端账户。

## 架构说明

- **前端**：零依赖原生 SPA，按职责拆分为 `util / api / store / modals / ui / app` 六个经典脚本，共享全局作用域（避免构建步骤），逻辑清晰、易于维护。
- **后端**：单个 Cloudflare Worker 同时托管静态资源与 `/api` 接口；无状态，所有持久化在 D1。
- **同步协议**：客户端先写本地缓存（离线可用），云端模式上传/拉取增量；记录级 LWW + 墓碑 + since 游标 + 离线写队列（网络恢复自动回放）。

## Web Push（还款提醒）配置

1. 在 Cloudflare 后台 Workers → ccms → Settings → Variables & Secrets 添加两个变量（Secrets）：
   - `VAPID_PUBLIC_KEY`：前端 `index.html` 已内置与之配对的公钥（以字节数组形式内置，运行时还原为 base64url），无需手动填写；仅服务端真正发送推送时需与本变量一致。
   - `VAPID_PRIVATE_KEY`：与公钥配对的私钥；在后台 Variables & Secrets 配置（**切勿提交到仓库**；如需自建可运行 `npx web-push generate-vapid-keys` 并同步替换 `index.html` 中的 `window.VAPID_PUBLIC` 字节数组）。
2. 用户在「设置 → 开启还款提醒」授予通知权限后即可接收每日提醒；未配置密钥时功能优雅降级（按钮提示未配置，不报错）。
3. Cron 触发器已在 `wrangler.toml` 的 `[triggers]` 中配置（`0 9 * * *`，每天 09:00）；通过 Git 构建部署时也可在后台手动设置。

## 后续演进

1. 账单分类、消费明细。
2. 卡面图片迁移到 R2，减轻 D1 行大小。
3. 登录失败限速、邮箱验证、第三方登录。

---

仓库：https://github.com/E5-lab/CCMS
