# CCMS · 信用卡账单管理

> 一个用于记录多张信用卡**月度账单、年度账单、历年账单汇总**的管理工具。
> 前端为零依赖原生单页应用；数据存储支持**本地（localStorage）**与**云端账户（Cloudflare D1 + 邮箱密码鉴权）**双模式。

## 功能

- 💳 **信用卡管理**：增删改多张信用卡（银行、卡号后 4 位、账单日、还款日、免息期、信用额度、颜色标签）。
- 🖼️ **卡面图片**：支持**本地上传**或**图床链接（URL）**两种方式（二选一），卡片优先展示图片，无图回退到颜色，便于区分多张卡、更美观。
- 📅 **月度账单**：按年/月查看各卡本期账单、已还、待还、还款日、状态，自动汇总；**还款日可按卡片设置自动生成**（可手动覆盖）。
- 🗄️ **已注销模块**：独立导航保留已注销信用卡与玩卡经历，可随时恢复或彻底删除。
- 📊 **年度汇总**：各卡年度合计 + 全年月度走势（SVG 图表）。
- 🗂️ **历年汇总**：跨年总览与对比。
- 🧭 **概览面板**：有效卡数、本月账单、最近待还、总额度速览。
- 💾 **跨设备 / 备份**：「设置」中一键导出 / 导入 JSON 备份，无需任何后端即可在多设备间迁移数据。
- ☁️ **（可选）云端账户同步（自动）**：进阶在 Cloudflare 后台绑定 D1 后，注册/登录真实账号；**登录即拉取云端最新数据，本地任何改动立即上传，窗口聚焦/重新可见时自动同步其它设备的改动**（邮箱+密码，按账号隔离）。
- 📲 **PWA 可安装**：支持作为独立应用安装到手机/桌面（含离线访问），见下方说明。
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

### （可选进阶）多设备云端同步 —— Cloudflare D1 + 账号鉴权
如果你希望多设备自动实时同步（而不是用下面的导出/导入文件），可在 Cloudflare 后台手动绑定 D1（仍无需本地凭证）：
1. 后台 → **Storage & Databases** → **D1 SQL Engine** → Create，数据库名 `ccms`。
2. 进入该数据库 **Console**，依次粘贴执行 `migrations/0001_init.sql` 与 `migrations/0002_auth.sql` 的全部内容建表（含用户/会话表）。
3. 后台 → **Workers & Pages** → `ccms` → **Settings** → **Bindings** → Add binding：
   Type 选 **D1 Database**，Variable name 填 **`DB`**，选 `ccms`，保存。
4. 访问站点，「设置 → 云端账户」用**邮箱+密码注册/登录**，本地数据会自动上传，多设备用同一账号自动同步。
5. 未绑定 D1 时调用同步会提示「云端存储未启用」，不影响本地模式。

> 本地开发如需用 D1：取消 `wrangler.toml` 中 `[[d1_databases]]` 注释并填 `database_id`，再 `npx wrangler d1 migrations apply ccms --local` 后 `npm run dev`。

## 跨设备（最简单，无需云端）
「设置 → 备份与跨设备迁移」可一键**导出备份 JSON**；换设备后在同页面**导入备份**即可恢复全部数据。这是最省事的跨设备方式，不依赖任何后端。

## PWA 安装（作为独立应用）
本项目包含 `manifest.webmanifest` 与 `sw.js`（`public/` 下），部署后即为可安装 PWA：
- 浏览器地址栏会出现「安装」图标；手机浏览器「添加到主屏幕」即可像原生 App 一样打开。
- 支持离线访问（应用外壳缓存），API 请求始终走网络保证数据实时。
- 图标由 `gen_icons.py` 生成（纯 Python，无需第三方库），如需替换品牌色/图形可改后重跑。

## 数据模型

- **信用卡** `{ id, name, bank, last4, billingDay, dueDay, gracePeriod, limit, color, image, closed, closedAt, updatedAt }`
  - `closed`：是否已注销；`image`：卡面图片（data URL）；`gracePeriod`：免息期天数。
- **月度账单** `{ id, cardId, period: "YYYY-MM", statement, paid, status, dueDate, note, updatedAt }`
  - `status`：`unpaid`(未还) / `paid`(已还) / `min`(最低还款)
- **用户系统**：`users(id, email, pass_hash, salt, created_at)`、`sessions(token, user_id, expires_at)`

云端模式下，两张表均增加 `owner` 字段（= 用户 id），数据按账号隔离，并按 `updatedAt` 最后写入优先。

## 安全说明

- 已采用**正式账号鉴权**：密码使用 PBKDF2（10 万次迭代）+ 随机盐哈希存储，服务端不留存明文；会话令牌存 D1，30 天有效期；数据按 `user_id` 隔离。
- 纯前端无后端依赖时（本地存储模式）数据仅存于浏览器；如需更强保护，可启用云端账户并建议后续将卡面图片迁移到 Cloudflare R2 对象存储。

## 后续演进

1. 账单分类、消费明细、还款提醒、导出 CSV / 对接银行账单导入。
2. 卡面图片迁移到 R2，减轻 D1 行大小。
3. 可选：登录失败限速、邮箱验证、第三方登录。

---

仓库：https://github.com/E5-lab/CCMS

---

## 近期更新（2026-10）

### 新增功能
- **主动还款提醒（Cron + Web Push）**：Worker 每日 09:00 扫描「3 天内到期且未还」的账单，通过浏览器 Web Push 主动推送。需在 Worker 环境变量配置 VAPID 密钥（见 `wrangler.toml` 注释，已预生成一对可用密钥）。
- **积分 / 年费追踪**：信用卡编辑弹窗新增「积分余额 / 年费（元）/ 年费日期（每年）」，方便管理权益与年费周期。
- **CSV 账单导入**：设置页「数据管理 → 导入 CSV 账单」，提供模板下载、字段映射、按卡片名称自动匹配或新建、导入前预览与校验。

### 体验与安全优化
- 移除左下角「导入示例数据」；将「清空所有数据」等高风险的按钮移入「设置 → 危险操作」面板。
- 登录 / 账户信息改为右上角主流布局：头像 + 邮箱 + 下拉菜单（账户设置 / 退出登录）；未登录时显示「登录 / 注册」入口。
- 同步架构升级为：记录级 **Last-Write-Wins** + **墓碑删除** + **增量同步（since 游标）** + **离线写队列**（网络恢复自动回放）。
- 修复卡面图片 URL 直拼 `style` 导致的 **XSS 漏洞**（仅允许 `data:image` 与 `https`，并转义）；备份导入增加结构与类型校验（`validateBackup`）。

### Web Push（还款提醒）配置
1. 在 Cloudflare 后台 Workers → ccms → Settings → Variables & Secrets 添加：
   - `VAPID_PUBLIC_KEY` = `BBZlC1P0Ktdnq4tdOtLyoKlLNgHavp7Vt571etvciqgr_JBYzwhX6BmMWue2oIP4RtGtzjbTF1h1sivi5hWNJxQ`
   - `VAPID_PRIVATE_KEY` = （与公钥配对的私钥；在后台 Variables & Secrets 配置，**切勿提交到仓库**；如需自建可运行 `npx web-push generate-vapid-keys` 并同步替换 index.html 中的 `window.VAPID_PUBLIC`）
2. 前端 `index.html` 已内置上述公钥（`window.VAPID_PUBLIC`）用于浏览器订阅；服务端真正发送推送时需两个环境变量齐全。
3. 用户在「设置 → 开启还款提醒」授予通知权限后即可接收每日提醒；未配置密钥时功能优雅降级（按钮提示未配置，不报错）。
