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
// 注意：必须用单引号包裹 url，否则与外层 style="..." 的双引号互相截断，导致图片无法显示
function imgCss(v) { const s = safeImage(v); return s ? `url('${s}')` : ''; }
// 卡面样式：有图用背景图（带背景色兜底），无图用纯色
function cardFaceStyle(c) {
  const color = c.color || '#4f46e5';
  const img = imgCss(c.image);
  return img
    ? `background-color:${color};background-image:${img};background-size:cover;background-position:center;background-repeat:no-repeat`
    : `background:${color}`;
}

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
    annual_fee_type: c.annual_fee_type === 'swipe' || c.annual_fee_type === 'points' ? c.annual_fee_type : 'amount',
    annual_fee_swipe: Number(c.annual_fee_swipe) || null, annual_fee_points: Number(c.annual_fee_points) || null,
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

/* ------------------------------- 主题（亮/暗） ------------------------------- */
function getTheme() { return localStorage.getItem('ccms.theme') || 'light'; }
function setTheme(theme) {
  localStorage.setItem('ccms.theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

/* ------------------------------- 昵称（账户显示名） ------------------------------- */
function getNickname() { return localStorage.getItem('ccms.nickname') || ''; }
function setNickname(n) { localStorage.setItem('ccms.nickname', n || ''); }

/* ------------------------------- 总授信额度：同银行取最高，不叠加 ------------------------------- */
function totalLimitByBank(list) {
  const byBank = {};
  list.forEach(c => {
    const k = (c.bank || '').trim() || '未分类';
    const lim = Number(c.limit) || 0;
    if (!byBank[k] || lim > byBank[k]) byBank[k] = lim;
  });
  return Object.values(byBank).reduce((s, v) => s + v, 0);
}

/* ------------------------------- 多语言（i18n） ------------------------------- */
const I18N = {
  zh: {
    overview: '概览', cards: '信用卡', closed: '已注销', monthly: '月度账单', annual: '年度汇总', history: '历年汇总', settings: '设置',
    appName: 'CCMS', addCard: '+ 新增信用卡', addBill: '+ 录入账单', loginReg: '登录 / 注册',
    accountSettings: '账户设置', logout: '退出登录', export: '导出备份', import: '导入备份', importCsv: '导入 CSV 账单',
    clearAll: '清空所有数据', pullNow: '立即拉取', enablePush: '开启还款提醒',
    storageData: '数据存储与账户', dataMgmt: '数据管理', dangerOps: '危险操作', about: '关于',
    localStore: '本地存储', cloudStore: '云端账户（D1）',
    activeCards: '有效信用卡', totalLimit: '总授信额度', sameBankMax: '同银行取最高',
    monthBill: '本月账单', unpaid: '未还', yearBill: '本年累计账单', upcoming: '待还提醒',
    recentDue: '最近待还', noDue: '暂无待还账单', myCards: '我的信用卡', tapCardHint: '点击卡片查看/管理',
    nickname: '昵称', email: '邮箱', password: '密码', saveNick: '保存昵称', theme: '主题', language: '语言',
    light: '浅色', dark: '深色', zh: '中文', en: 'English',
    cardName: '卡片名称', bank: '银行', last4: '卡号后 4 位', billingDay: '账单日', dueDay: '还款日',
    gracePeriod: '免息期（天）', limit: '信用额度', points: '积分余额', feeType: '年费类型',
    feeAmount: '年费金额（元）', feeSwipe: '免年费刷卡次数', feePoints: '免年费所需积分', feeDate: '年费日期（每年）',
    colorTag: '颜色标签', colorPreview: '颜色预览', cardImage: '卡面图片（本地上传 或 图床链接，二选一）',
    closed: '已注销（移至「已注销」模块）', closedAt: '注销日期', cancel: '取消', save: '保存',
    newCard: '新增信用卡', editCard: '编辑信用卡', uploadHint: '上传卡面图片（可选）',
    billOf: '账单月份', stmtAmt: '本期账单金额', paidAmt: '已还金额', billStatus: '还款状态', dueDate: '还款日', note: '备注',
    newBill: '录入账单', editBill: '编辑账单', auto: '自动',
    feeTypeAmount: '固定金额', feeTypeSwipe: '刷卡免年费', feeTypePoints: '积分兑换免年费',
  },
  en: {
    overview: 'Overview', cards: 'Cards', closed: 'Closed', monthly: 'Monthly', annual: 'Annual', history: 'History', settings: 'Settings',
    appName: 'CCMS', addCard: '+ Add Card', addBill: '+ Add Bill', loginReg: 'Login / Register',
    accountSettings: 'Account Settings', logout: 'Log out', export: 'Export', import: 'Import', importCsv: 'Import CSV',
    clearAll: 'Clear All Data', pullNow: 'Sync Now', enablePush: 'Enable Reminders',
    storageData: 'Storage & Account', dataMgmt: 'Data Management', dangerOps: 'Danger Zone', about: 'About',
    localStore: 'Local Storage', cloudStore: 'Cloud Account (D1)',
    activeCards: 'Active Cards', totalLimit: 'Total Credit', sameBankMax: 'Max per bank',
    monthBill: 'This Month', unpaid: 'Unpaid', yearBill: 'YTD Billed', upcoming: 'Due Soon',
    recentDue: 'Upcoming Payments', noDue: 'No upcoming bills', myCards: 'My Cards', tapCardHint: 'Tap a card to manage',
    nickname: 'Nickname', email: 'Email', password: 'Password', saveNick: 'Save Nickname', theme: 'Theme', language: 'Language',
    light: 'Light', dark: 'Dark', zh: '中文', en: 'English',
    cardName: 'Card Name', bank: 'Bank', last4: 'Last 4 Digits', billingDay: 'Statement Day', dueDay: 'Due Day',
    gracePeriod: 'Grace (days)', limit: 'Credit Limit', points: 'Points', feeType: 'Annual Fee Type',
    feeAmount: 'Fee Amount', feeSwipe: 'Swipes to Waive', feePoints: 'Points to Waive', feeDate: 'Fee Date (each year)',
    colorTag: 'Color Tag', colorPreview: 'Color Preview', cardImage: 'Card Image (upload or image URL)',
    closed: 'Closed (move to Closed)', closedAt: 'Closed Date', cancel: 'Cancel', save: 'Save',
    newCard: 'Add Card', editCard: 'Edit Card', uploadHint: 'Upload card image (optional)',
    billOf: 'Billing Month', stmtAmt: 'Statement', paidAmt: 'Paid', billStatus: 'Status', dueDate: 'Due Date', note: 'Note',
    newBill: 'Add Bill', editBill: 'Edit Bill', auto: 'Auto',
    feeTypeAmount: 'Fixed Amount', feeTypeSwipe: 'Waived by Swipes', feeTypePoints: 'Waived by Points',
  },
};
let lang = localStorage.getItem('ccms.lang') || 'zh';
function t(k) { return (I18N[lang] && I18N[lang][k] != null) ? I18N[lang][k] : (I18N.zh[k] != null ? I18N.zh[k] : k); }
function setLang(l) { lang = l; localStorage.setItem('ccms.lang', l); if (typeof render === 'function') render(); }
