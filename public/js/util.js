/* =========================================================================
 * CCMS · 通用工具与纯函数
 * 该文件只定义无状态工具，被其它模块通过全局作用域共享（经典 <script> 加载）。
 * 全局状态（cards / bills / view / sel / now）在 app.js 中声明。
 * ========================================================================= */

// localStorage 键名集中管理
const LS = {
  cards: 'ccms.cards.v1', bills: 'ccms.bills.v1', mode: 'ccms.mode',
  email: 'ccms.email', session: 'ccms.session', cursor: 'ccms.cursor.v2', // v2：旧游标被“超前时间戳”污染，升级键名强制全量重拉一次自愈
};

/* ------------------------------- 基础工具 ------------------------------- */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function money(n) {
  const v = Number(n) || 0;
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad2(n) { return String(n).padStart(2, '0'); }
function monthKey(y, m) { return `${y}-${pad2(m)}`; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------- 数据查询 ------------------------------- */
function cardById(id) { return cards.find(c => c.id === id); }
function statusText(s) { return { unpaid: '未还', paid: '已还', min: '最低还款' }[s] || '未还'; }
function statusClass(s) { return ['unpaid', 'paid', 'min'].includes(s) ? s : 'unpaid'; }
function activeCards() { return cards.filter(c => !c.closed); }

/* ------------------------------- 安全 ------------------------------- */
// 仅允许 data:image 或 http(s) 链接，杜绝 XSS / CSS 注入
function safeImage(v) {
  if (!v) return '';
  if (/^data:image\//i.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v.replace(/['"()\\]/g, '');
  return '';
}
function imgCss(v) { const s = safeImage(v); return s ? `url("${s}")` : ''; }

// 备份文件校验：结构 + 类型 + 字段裁剪（并做卡面 URL 白名单清洗）
function validateBackup(d) {
  if (!d || typeof d !== 'object') throw new Error('文件不是合法的 JSON');
  if (!Array.isArray(d.cards) || !Array.isArray(d.bills)) throw new Error('缺少 cards / bills 数组');
  const cleanCard = (c) => ({
    id: String(c.id || uid()), name: String(c.name || ''), bank: String(c.bank || ''),
    last4: String(c.last4 || ''), billingDay: Number(c.billingDay) || null, dueDay: Number(c.dueDay) || null,
    gracePeriod: Number(c.gracePeriod) || null, limit: Number(c.limit) || null, color: String(c.color || '#4f46e5'),
    image: safeImage(c.image), closed: !!c.closed, closedAt: String(c.closedAt || ''),
    points: Number(c.points) || null, annual_fee: Number(c.annual_fee) || null, annual_fee_date: String(c.annual_fee_date || ''),
    updatedAt: Number(c.updatedAt) || Date.now(),
  });
  const cleanBill = (b) => ({
    id: String(b.id || uid()), cardId: String(b.cardId || ''), period: String(b.period || ''),
    statement: Number(b.statement) || 0, paid: Number(b.paid) || 0, status: ['unpaid', 'paid', 'min'].includes(b.status) ? b.status : 'unpaid',
    dueDate: String(b.dueDate || ''), note: String(b.note || ''), updatedAt: Number(b.updatedAt) || Date.now(),
  });
  return { cards: d.cards.map(cleanCard), bills: d.bills.map(cleanBill) };
}

// 自动生成还款日：依据卡片账单日(billingDay)与还款日(dueDay)
// 若还款日 <= 账单日，则顺延至下一月；否则同月。
function autoDueDate(card, period) {
  if (!card) return '';
  const [y, m] = period.split('-').map(Number);
  const bd = Number(card.billingDay) || 1;
  const dd = Number(card.dueDay) || 25;
  let yy = y, mm = m;
  if (dd <= bd) { mm = m + 1; if (mm > 12) { mm = 1; yy = y + 1; } }
  return `${yy}-${pad2(mm)}-${pad2(Math.min(dd, 28))}`;
}

/* ------------------------------- CSV 解析（RFC4180 简化） ------------------------------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  text = text.replace(/^\uFEFF/, ''); // 去除 UTF-8 BOM
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* 忽略 */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/* ------------------------------- SVG 柱状图 ------------------------------- */
function barChart(values, labels, fmt) {
  const W = 720, H = 220, pad = 30, n = values.length;
  const max = Math.max(1, ...values);
  const bw = (W - pad * 2) / n * 0.6;
  const gap = (W - pad * 2) / n;
  const bars = values.map((v, i) => {
    const h = (v / max) * (H - pad * 2);
    const x = pad + i * gap + (gap - bw) / 2;
    const y = H - pad - h;
    return `<g>
      <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" fill="#4f46e5"></rect>
      <text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="#5b6472">${fmt ? fmt(v) : v}</text>
      <text x="${x + bw / 2}" y="${H - pad + 16}" text-anchor="middle" font-size="11" fill="#5b6472">${esc(labels[i])}</text>
    </g>`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e6e8ef"></line>${bars}
  </svg></div>`;
}

/* ------------------------------- 下拉选项 ------------------------------- */
function yearOptions(selY) {
  const years = [...new Set([...bills.map(b => +b.period.slice(0, 4)), selY, now.getFullYear()])].sort((a, b) => b - a);
  return years.map(y => `<option value="${y}" ${y === selY ? 'selected' : ''}>${y} 年</option>`).join('');
}
function monthOptions(selM) {
  return Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => `<option value="${m}" ${m === selM ? 'selected' : ''}>${m} 月</option>`).join('');
}
