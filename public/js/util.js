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
    lounge_count: Number(c.lounge_count) || null, benefits: String(c.benefits || ''),
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

/* ------------------------------- 图标（内联 SVG，统一线性风格，替代 emoji） ------------------------------- */
// 全部为 24x24 视图、stroke 描边风格，颜色继承 currentColor，自动适配亮/暗主题。
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/>',
  cards: '<rect x="2" y="5" width="20" height="14" rx="3"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/><line x1="14" y1="15" x2="18" y2="15"/>',
  bills: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  benefits: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5" rx="1.5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  restore: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><line x1="12" y1="1.5" x2="12" y2="3.5"/><line x1="12" y1="20.5" x2="12" y2="22.5"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1.5" y1="12" x2="3.5" y2="12"/><line x1="20.5" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1.5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  check: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14 9 11"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.5 0"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
};
// 生成内联 SVG 字符串；size 可选（px），cls 追加类名
function svgIcon(name, cls, size) {
  const path = ICONS[name] || ICONS.info;
  const w = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="ico ${cls || ''}" viewBox="0 0 24 24"${w} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
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
    billsNav: '账单', benefitsNav: '权益专区', tabMonthly: '月度', tabAnnual: '年度',
    cardsActive: '有效卡', cardsClosed: '已注销', loungeCount: '机场贵宾厅次数',
    benefitsInfo: '权益说明', benefitsHint: '查看每张有效卡的年费与专属权益',
    feeLabel: '年费', loungeLabel: '机场贵宾厅', noBenefit: '未填写权益说明',
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
    billsNav: 'Bills', benefitsNav: 'Benefits', tabMonthly: 'Monthly', tabAnnual: 'Annual',
    cardsActive: 'Active', cardsClosed: 'Closed', loungeCount: 'Airport Lounge Visits',
    benefitsInfo: 'Benefits', benefitsHint: 'Annual fee & perks for each active card',
    feeLabel: 'Annual Fee', loungeLabel: 'Lounge', noBenefit: 'No benefits noted',
  },
};
let lang = localStorage.getItem('ccms.lang') || 'zh';
function t(k) { return (I18N[lang] && I18N[lang][k] != null) ? I18N[lang][k] : (I18N.zh[k] != null ? I18N.zh[k] : k); }
function setLang(l) { lang = l; localStorage.setItem('ccms.lang', l); if (typeof render === 'function') render(); }
