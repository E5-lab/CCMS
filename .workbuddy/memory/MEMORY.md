# CCMS 项目长期记忆

## 项目定位
- CCMS：信用卡账单管理 Web 应用（多卡月度/年度/历年账单）。仓库 `https://github.com/E5-lab/CCMS`，部署于 Cloudflare（Workers 静态资源 + SPA 回退，或 Pages）。
- 零依赖原生 SPA；可选云端账户用 Cloudflare D1 + 邮箱密码鉴权。

## 程序架构（2026-10-19 重构后）
- 前端按职责拆分为 6 个经典 `<script>`（`public/js/` 下，共享全局作用域，无构建步骤）：
  - `util.js` 工具/安全清洗(`safeImage`/`imgCss`)/CSV 解析/图表；`api.js` 鉴权+同步接口；`store.js` 数据层(`Store`+`mergeLWW`+`flushQueue`)；`modals.js` 弹窗+`commit`；`ui.js` 渲染+事件；`app.js` 入口(全局状态 `cards/bills/view/sel/now`)。
- 后端：单 `src/worker.js`，同时托管静态资源与 `/api` 接口 + Cron 还款提醒 + `initDb()` 自动建表。
- 同步：记录级 LWW + 墓碑删除 + since 增量游标 + 离线写队列。

## 部署与 D1
- D1 建表由 Worker `initDb()` 首次访问自动完成，**无需手动 SQL**；`npm run setup:d1`（建库+部署）一条命令即可。绑定写在 `wrangler.toml` 的 `[[d1_databases]]`（`database_id="${CCMS_D1_ID}"`，ID 存 `.env` 不进仓库）。
- VAPID 公钥以字节数组内置 `index.html`（`window.VAPID_PUBLIC`）；私钥仅配 Cloudflare Secrets，勿入库。

## 安全要点
- 卡面图片 XSS：仅允许 `data:image`/`https`；备份导入 `validateBackup` 校验+清洗。
- 鉴权：PBKDF2（10 万次迭代）+ 随机盐；会话 30 天。

## 用户协作偏好（见全局 MEMORY.md）
- 不执行本地依赖安装/构建验证、不做本地浏览器冒烟；完成即推送，验证交给用户。
- 推送优先 SSH；GitHub PAT 勿直接贴对话（会被脱敏）。
