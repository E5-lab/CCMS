# CCMS · 信用卡账单管理

> 一个用于记录多张信用卡**月度账单、年度账单、历年账单汇总**的管理工具。
> 当前为可运行 **demo**，数据存储于浏览器本地（localStorage），便于快速评估交互与数据模型。

## 功能（demo）

- 💳 **信用卡管理**：增删改多张信用卡（银行、卡号后 4 位、账单日、还款日、信用额度、颜色标签）。
- 📅 **月度账单**：按年/月查看每张卡的本期账单、已还金额、还款状态与还款日，自动汇总。
- 📊 **年度汇总**：选定年份，查看各卡合计、全年月度走势（SVG 图表）。
- 🗂️ **历年汇总**：跨年总览，对比各年账单规模。
- 🧭 **概览面板**：卡片数、本月账单、最近待还、总额度等速览。
- 🧪 内置「导入示例数据」便于快速体验。

## 目录结构

```
.
├── public/            # 前端单页应用（零依赖，原生 HTML/CSS/JS）
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   └── worker.js      # Cloudflare Worker 入口（静态托管 + 预留 /api）
├── wrangler.toml      # Cloudflare Workers 配置
└── package.json
```

## 本地预览

```bash
npm install
npm run dev        # 启动 wrangler dev，默认 http://localhost:8787
```

也可直接用浏览器打开 `public/index.html` 体验（localStorage 同样可用）。

## 部署到 Cloudflare Workers

```bash
npm install
npm run deploy
```

部署后访问分配的 `*.workers.dev` 域名即可。

## 数据模型（demo · localStorage）

- `ccms.cards.v1`：信用卡数组
  ```
  { id, name, bank, last4, billingDay, dueDay, limit, color }
  ```
- `ccms.bills.v1`：月度账单数组
  ```
  { id, cardId, period: "YYYY-MM", statement, paid, status, dueDate, note }
  ```
  - `status`：`unpaid`(未还) / `paid`(已还) / `min`(最低还款)

## 后续演进（确认方向后）

1. 存储从 `localStorage` 迁移到 **Cloudflare D1（SQLite）**，支持多设备同步。
2. 在 `src/worker.js` 扩展 `/api/*` 路由，加入后端 API 与基础鉴权。
3. 支持账单分类、消费明细、还款提醒、导出 CSV / 对接银行账单导入。

---

仓库：https://github.com/E5-lab/CCMS
