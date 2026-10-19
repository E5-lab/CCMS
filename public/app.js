/* =========================================================================
 * CCMS · 信用卡账单管理
 * 纯前端单页应用，支持两种存储模式：
 *   - 本地存储（localStorage）：开箱即用，适合单机/快速体验
 *   - 云端账户（Cloudflare D1）：注册/登录真实账号，多设备自动同步，按用户隔离
 * ========================================================================= */

const LS = { cards: 'ccms.cards.v1', bills: 'ccms.bills.v1', mode: 'ccms.mode', email: 'ccms.email', session: 'ccms.session' };

let cards = [];
let bills = [];
let view = 'dashboard';
const now = new Date();
const sel = { year: now.getFullYear(), month: now.getMonth() + 1 };

/* --------------------------- 数据层（双模式） --------------------------- */
const Store = {
  mode: localStorage.getItem(LS.mode) || 'local',     // 'local' | 'cloud'
  email: localStorage.getItem(LS.email) || '',
  session: localStorage.getItem(LS.session) || '',
  pendingDelete: { cards: [], bills: [] },

  // 仅当「云端账户」模式且已登录时才走远端接口；否则回退本地
  get isCloud() { return this.mode === 'cloud' && !!this.session; },

  async load() {
    if (this.isCloud) {
      const r = await fetch('/api/state', { headers: { 'authorization': 'Bearer ' + this.session } });
      if (!r.ok) throw new Error(await apiError(r, '同步拉取失败'));
      const d = await r.json();
      return {
        cards: (d.cards || []).map(c => ({ ...c, closed: !!c.closed })),
        bills: d.bills || [],
      };
    }
    return { cards: load(LS.cards, []), bills: load(LS.bills, []) };
  },

  async save(cards, bills) {
    if (this.isCloud) {
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + this.session },
        body: JSON.stringify({
          cards, bills,
          deleteCards: this.pendingDelete.cards,
          deleteBills: this.pendingDelete.bills,
        }),
      });
      if (!r.ok) throw new Error(await apiError(r, '同步失败'));
      const d = await r.json();
      this.pendingDelete = { cards: [], bills: [] };
      return {
        cards: (d.cards || []).map(c => ({ ...c, closed: !!c.closed })),
        bills: d.bills || [],
      };
    }
    localStorage.setItem(LS.cards, JSON.stringify(cards));
    localStorage.setItem(LS.bills, JSON.stringify(bills));
    return { cards, bills };
  },

  // 注册 / 登录 / 登出
  async register(email, password) {
    const r = await fetch('/api/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await apiError(r, '注册失败'));
    return r.json();
  },
  async login(email, password) {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await apiError(r, '登录失败'));
    return r.json();
  },
  async logout() {
    if (this.session) {
      try {
        await fetch('/api/logout', { method: 'POST', headers: { 'authorization': 'Bearer ' + this.session } });
      } catch (e) { /* ignore */ }
    }
    this.session = ''; this.email = '';
    localStorage.removeItem(LS.session); localStorage.removeItem(LS.email);
  },
};

/* ------------------------------- 工具 ------------------------------- */
// 读取 API 错误响应中的友好提示（如 D1 未绑定）
async function apiError(r, fallback) {
  try {
    const d = await r.json();
    if (d && d.message) return d.message;
    if (d && d.error) return fallback + '：' + d.error;
  } catch (e) { /* ignore */ }
  return fallback + ' (' + r.status + ')';
}
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
function cardById(id) { return cards.find(c => c.id === id); }
function statusText(s) { return { unpaid: '未还', paid: '已还', min: '最低还款' }[s] || '未还'; }
function statusClass(s) { return ['unpaid', 'paid', 'min'].includes(s) ? s : 'unpaid'; }
function activeCards() { return cards.filter(c => !c.closed); }

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

/* ------------------------------- 渲染路由 ------------------------------- */
const TITLES = {
  dashboard: '概览', cards: '信用卡', closed: '已注销', monthly: '月度账单',
  annual: '年度汇总', history: '历年汇总', settings: '设置',
};

function render() {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('pageTitle').textContent = TITLES[view];
  const root = document.getElementById('viewRoot');
  const actions = document.getElementById('topActions');
  actions.innerHTML = '';

  if (view === 'dashboard') root.innerHTML = renderDashboard();
  else if (view === 'cards') { root.innerHTML = renderCards(); renderCardsActions(actions); }
  else if (view === 'closed') root.innerHTML = renderClosed();
  else if (view === 'monthly') { root.innerHTML = renderMonthly(); renderMonthlyControls(actions); }
  else if (view === 'annual') { root.innerHTML = renderAnnual(); renderYearControls(actions); }
  else if (view === 'history') root.innerHTML = renderHistory();
  else if (view === 'settings') root.innerHTML = renderSettings();

  bindViewEvents();
}

/* ------------------------------- 概览 ------------------------------- */
function renderDashboard() {
  const ym = monthKey(sel.year, sel.month);
  const monthBills = bills.filter(b => b.period === ym);
  const monthTotal = monthBills.reduce((s, b) => s + (Number(b.statement) || 0), 0);
  const monthUnpaid = monthBills
    .filter(b => b.status !== 'paid')
    .reduce((s, b) => s + ((Number(b.statement) || 0) - (Number(b.paid) || 0)), 0);

  const upcoming = bills
    .filter(b => b.status !== 'paid' && b.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  const act = activeCards();
  const totalLimit = act.reduce((s, c) => s + (Number(c.limit) || 0), 0);
  const yearTotal = bills
    .filter(b => b.period.startsWith(String(sel.year)))
    .reduce((s, b) => s + (Number(b.statement) || 0), 0);

  const stats = [
    { label: '有效信用卡', value: act.length, sub: `总额度 ${money(totalLimit)}` },
    { label: `${sel.year}年${sel.month}月账单`, value: money(monthTotal), sub: `未还 ${money(monthUnpaid)}` },
    { label: `${sel.year}年累计账单`, value: money(yearTotal), sub: '本年截至目前' },
    { label: '待还提醒', value: upcoming.length, sub: '笔即将到期' },
  ];

  let html = `<div class="stat-grid">` + stats.map(s => `
    <div class="stat-card">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
      <div class="sub">${s.sub}</div>
    </div>`).join('') + `</div>`;

  html += `<div class="panel"><div class="panel-title">最近待还</div>`;
  if (upcoming.length === 0) {
    html += `<div class="empty"><div class="big">✅</div>暂无待还账单</div>`;
  } else {
    html += `<table><thead><tr><th>信用卡</th><th>账单月份</th><th>本期账单</th><th>已还</th><th>还款日</th><th>状态</th></tr></thead><tbody>`;
    html += upcoming.map(b => {
      const c = cardById(b.cardId);
      return `<tr>
        <td>${esc(c ? c.name : '已删卡')}</td>
        <td>${b.period}</td><td>${money(b.statement)}</td><td>${money(b.paid)}</td>
        <td>${esc(b.dueDate)}</td>
        <td><span class="badge ${statusClass(b.status)}">${statusText(b.status)}</span></td>
      </tr>`;
    }).join('');
    html += `</tbody></table>`;
  }
  html += `</div>`;
  return html;
}

/* ------------------------------- 信用卡（有效） ------------------------------- */
function ccCardHtml(c) {
  const bg = c.image
    ? `background-image:url('${c.image}')`
    : `background:${esc(c.color || '#4f46e5')}`;
  const grace = c.gracePeriod ? ` · 免息期 ${esc(c.gracePeriod)} 天` : '';
  return `<div class="cc-card" style="${bg}">
    <div class="cc-overlay"></div>
    <div class="cc-actions">
      <button data-edit-card="${c.id}" title="编辑">✎</button>
      <button data-del-card="${c.id}" title="删除">🗑</button>
    </div>
    <div>
      <div class="cc-bank">${esc(c.bank || '未填银行')}</div>
      <div class="cc-num">•••• ${esc(c.last4 || '****')}</div>
    </div>
    <div>
      <div class="cc-bank">${esc(c.name)}</div>
      <div class="cc-meta">账单日 ${esc(c.billingDay) || '—'} · 还款日 ${esc(c.dueDay) || '—'} · 额度 ${money(c.limit)}${grace}</div>
    </div>
  </div>`;
}

function renderCards() {
  const act = activeCards();
  if (act.length === 0) {
    return `<div class="empty"><div class="big">💳</div>还没有信用卡，点击右上角「新增信用卡」开始</div>`;
  }
  return `<div class="card-list">${act.map(ccCardHtml).join('')}</div>`;
}
function renderCardsActions(actions) {
  actions.innerHTML = `<button class="btn primary" id="addCardBtn">+ 新增信用卡</button>`;
}

/* ------------------------------- 已注销 ------------------------------- */
function renderClosed() {
  const closed = cards.filter(c => c.closed);
  if (closed.length === 0) {
    return `<div class="empty"><div class="big">🗂️</div>暂无已注销的信用卡。注销的卡片会出现在这里，保留你的玩卡经历。</div>`;
  }
  const items = closed.map(c => {
    const bg = c.image ? `background-image:url('${c.image}')` : `background:${esc(c.color || '#4f46e5')}`;
    const cnt = bills.filter(b => b.cardId === c.id).length;
    return `<div class="cc-card closed-card" style="${bg}">
      <div class="cc-overlay"></div>
      <div class="cc-actions">
        <button data-restore-card="${c.id}" title="恢复">↩</button>
        <button data-purge-card="${c.id}" title="彻底删除">🗑</button>
      </div>
      <div>
        <div class="cc-bank">${esc(c.bank || '未填银行')}</div>
        <div class="cc-num">•••• ${esc(c.last4 || '****')}</div>
      </div>
      <div>
        <div class="cc-bank">${esc(c.name)}</div>
        <div class="cc-meta">${c.closedAt ? '注销于 ' + esc(c.closedAt) : '已注销'} · 留存 ${cnt} 笔账单</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="panel"><div class="panel-title">已注销信用卡（${closed.length}）</div>
    <div class="card-list">${items}</div></div>`;
}

/* ------------------------------- 月度账单 ------------------------------- */
function renderMonthlyControls(actions) {
  actions.innerHTML = `
    <div class="controls">
      <select id="yearSel">${yearOptions(sel.year)}</select>
      <select id="monthSel">${monthOptions(sel.month)}</select>
      <button class="btn primary" id="addBillBtn">+ 录入账单</button>
    </div>`;
}
function renderMonthly() {
  const ym = monthKey(sel.year, sel.month);
  const act = activeCards();
  if (act.length === 0) {
    return `<div class="empty"><div class="big">💳</div>请先在「信用卡」中添加卡片</div>`;
  }
  const rows = act.map(c => {
    const b = bills.find(x => x.cardId === c.id && x.period === ym);
    if (!b) {
      return `<tr>
        <td><span class="dot" style="background:${esc(c.color || '#4f46e5')}"></span>${esc(c.name)}</td>
        <td class="muted">未录入</td><td class="muted">—</td><td class="muted">—</td>
        <td class="muted">—</td><td class="muted">—</td>
        <td><button class="btn sm" data-add-bill="${c.id}">录入</button></td>
      </tr>`;
    }
    const remain = (Number(b.statement) || 0) - (Number(b.paid) || 0);
    return `<tr>
      <td><span class="dot" style="background:${esc(c.color || '#4f46e5')}"></span>${esc(c.name)}</td>
      <td>${money(b.statement)}</td><td>${money(b.paid)}</td><td>${money(remain)}</td>
      <td>${esc(b.dueDate || '—')}</td>
      <td><span class="badge ${statusClass(b.status)}">${statusText(b.status)}</span></td>
      <td>
        <button class="btn sm" data-edit-bill="${b.id}">编辑</button>
        <button class="btn sm danger" data-del-bill="${b.id}">删除</button>
      </td>
    </tr>`;
  }).join('');

  const totalStmt = act.reduce((s, c) => {
    const b = bills.find(x => x.cardId === c.id && x.period === ym);
    return s + (b ? Number(b.statement) || 0 : 0);
  }, 0);
  const totalPaid = act.reduce((s, c) => {
    const b = bills.find(x => x.cardId === c.id && x.period === ym);
    return s + (b ? Number(b.paid) || 0 : 0);
  }, 0);

  return `<div class="panel">
    <div class="panel-title">${sel.year} 年 ${sel.month} 月 · 各卡账单</div>
    <table>
      <thead><tr><th>信用卡</th><th>本期账单</th><th>已还</th><th>待还</th><th>还款日</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>合计</td><td>${money(totalStmt)}</td><td>${money(totalPaid)}</td><td>${money(totalStmt - totalPaid)}</td><td colspan="3"></td></tr></tfoot>
    </table>
  </div>`;
}

/* ------------------------------- 年度汇总 ------------------------------- */
function renderYearControls(actions) {
  actions.innerHTML = `<div class="controls"><select id="yearSel2">${yearOptions(sel.year)}</select></div>`;
}
function renderAnnual() {
  const y = String(sel.year);
  const yb = bills.filter(b => b.period.startsWith(y));
  if (yb.length === 0) {
    return `<div class="empty"><div class="big">📊</div>${sel.year} 年暂无账单数据</div>`;
  }
  const totalStmt = yb.reduce((s, b) => s + (Number(b.statement) || 0), 0);
  const totalPaid = yb.reduce((s, b) => s + (Number(b.paid) || 0), 0);

  const byCard = {};
  yb.forEach(b => { byCard[b.cardId] = (byCard[b.cardId] || 0) + (Number(b.statement) || 0); });
  const cardRows = cards.filter(c => byCard[c.id] != null)
    .map(c => `<tr>
      <td><span class="dot" style="background:${esc(c.color || '#4f46e5')}"></span>${esc(c.name)}</td>
      <td>${money(byCard[c.id])}</td>
      <td>${yb.filter(b => b.cardId === c.id).length} 笔</td>
    </tr>`).join('') || `<tr><td colspan="3" class="muted">无</td></tr>`;

  const monthly = Array(12).fill(0);
  yb.forEach(b => { const m = parseInt(b.period.split('-')[1], 10); monthly[m - 1] += Number(b.statement) || 0; });

  const stats = [
    { label: '全年账单总额', value: money(totalStmt) },
    { label: '全年已还', value: money(totalPaid) },
    { label: '涉及卡片', value: Object.keys(byCard).length + ' 张' },
    { label: '月均账单', value: money(totalStmt / 12) },
  ];

  let html = `<div class="stat-grid">` + stats.map(s =>
    `<div class="stat-card"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`).join('') + `</div>`;

  html += `<div class="panel"><div class="panel-title">各卡年度合计</div>
    <table><thead><tr><th>信用卡</th><th>年度账单</th><th>笔数</th></tr></thead><tbody>${cardRows}</tbody></table></div>`;

  html += `<div class="panel"><div class="panel-title">${sel.year} 年月度走势（账单金额）</div>
    ${barChart(monthly, ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], money)}</div>`;
  return html;
}

/* ------------------------------- 历年汇总 ------------------------------- */
function renderHistory() {
  const years = [...new Set(bills.map(b => b.period.slice(0, 4)))].sort();
  if (years.length === 0) {
    return `<div class="empty"><div class="big">🗂️</div>暂无历史账单数据</div>`;
  }
  const data = years.map(y => {
    const yb = bills.filter(b => b.period.startsWith(y));
    const total = yb.reduce((s, b) => s + (Number(b.statement) || 0), 0);
    return { y, total, count: yb.length, cardsUsed: new Set(yb.map(b => b.cardId)).size };
  });
  const rows = data.map(d => `<tr>
    <td>${d.y} 年</td><td>${money(d.total)}</td><td>${d.count} 笔</td><td>${d.cardsUsed} 张</td>
  </tr>`).join('');
  const totals = data.map(d => d.total);

  return `<div class="panel"><div class="panel-title">历年账单总览</div>
    <table><thead><tr><th>年份</th><th>年度账单总额</th><th>账单笔数</th><th>涉及卡片</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <div class="panel"><div class="panel-title">历年对比</div>${barChart(totals, data.map(d => d.y + '年'), money)}</div>`;
}

/* ------------------------------- 设置（账户 / 同步） ------------------------------- */
function updateSyncState() {
  const el = document.getElementById('syncState');
  if (!el) return;
  if (Store.isCloud) {
    el.textContent = '云端账户 · ' + (Store.email || '已登录');
    el.classList.add('remote');
  } else {
    el.textContent = '本地存储';
    el.classList.remove('remote');
  }
}
function renderSettings() {
  const cloud = Store.mode === 'cloud';
  const loggedIn = Store.isCloud;
  const accountBlock = loggedIn
    ? `<div class="setting-row">
         <div>
           <div>已登录账户</div>
           <div class="desc">${esc(Store.email)} · 多设备用同一账号自动同步</div>
         </div>
         <button class="btn" id="logoutBtn">退出登录</button>
       </div>`
    : `<div class="setting-row">
         <div>
           <div style="margin-bottom:8px">邮箱</div>
           <input id="emailInput" placeholder="you@example.com" style="max-width:240px" value="${esc(Store.email)}">
           <div style="margin:8px 0 4px">密码</div>
           <input id="pwInput" type="password" placeholder="至少 6 位" style="max-width:240px">
           <div class="desc" style="margin-top:6px">注册即用该邮箱+密码，无需验证码；登录后本地数据会自动上传到云端。</div>
         </div>
         <div style="display:flex;flex-direction:column;gap:10px">
           <button class="btn primary" id="registerBtn">注册并启用云端</button>
           <button class="btn" id="loginBtn">登录已有账号</button>
         </div>
       </div>`;
  return `<div class="panel">
    <div class="panel-title">数据存储与账户</div>
    <div class="setting-row">
      <div>
        <div>
          <label class="switch"><input type="radio" name="mode" value="local" ${!cloud ? 'checked' : ''}> 本地存储</label>
          <label class="switch"><input type="radio" name="mode" value="cloud" ${cloud ? 'checked' : ''}> 云端账户（D1）</label>
        </div>
        <div class="desc">本地存储：数据仅存于当前浏览器。云端账户：注册/登录后在 Cloudflare D1 多设备同步，按账号隔离。</div>
      </div>
    </div>
    ${accountBlock}
    <div class="setting-row" style="border:none">
      <div class="desc">「立即拉取」从云端覆盖本地（云端模式且已登录时可用）。</div>
      <div style="display:flex;gap:10px">
        <button class="btn" id="pullBtn">立即拉取</button>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">备份与跨设备迁移（无需云端）</div>
    <div class="desc">把全部数据导出为 JSON 文件做备份；换设备/换浏览器时，导入该文件即可恢复。这是最简单的跨设备方式，不依赖任何后端。</div>
    <div style="display:flex;gap:10px;margin-top:10px">
      <button class="btn" id="exportBtn">导出备份</button>
      <button class="btn" id="importBtn">导入备份</button>
      <input id="importFile" type="file" accept="application/json,.json" style="display:none">
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">关于</div>
    <div class="desc">CCMS · 信用卡账单管理。卡面图片在本地以数据 URL 保存。</div>
  </div>`;
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

/* ------------------------------- 事件绑定 ------------------------------- */
function bindViewEvents() {
  const yearSel = document.getElementById('yearSel');
  const monthSel = document.getElementById('monthSel');
  const yearSel2 = document.getElementById('yearSel2');
  if (yearSel) yearSel.onchange = e => { sel.year = +e.target.value; render(); };
  if (monthSel) monthSel.onchange = e => { sel.month = +e.target.value; render(); };
  if (yearSel2) yearSel2.onchange = e => { sel.year = +e.target.value; render(); };

  const addBillBtn = document.getElementById('addBillBtn');
  if (addBillBtn) addBillBtn.onclick = () => openBillModal(null);
  const addCardBtn = document.getElementById('addCardBtn');
  if (addCardBtn) addCardBtn.onclick = () => openCardModal(null);

  document.querySelectorAll('[data-add-bill]').forEach(b => b.onclick = () => openBillModal(null, b.dataset.addBill));
  document.querySelectorAll('[data-edit-bill]').forEach(b => b.onclick = () => openBillModal(b.dataset.editBill));
  document.querySelectorAll('[data-del-bill]').forEach(b => b.onclick = () => {
    if (confirm('确定删除这笔账单？')) { bills = bills.filter(x => x.id !== b.dataset.delBill); Store.pendingDelete.bills.push(b.dataset.delBill); commit(); }
  });
  document.querySelectorAll('[data-edit-card]').forEach(b => b.onclick = () => openCardModal(b.dataset.editCard));
  document.querySelectorAll('[data-del-card]').forEach(b => b.onclick = () => {
    const c = cardById(b.dataset.delCard);
    const used = bills.filter(x => x.cardId === b.dataset.delCard).length;
    const msg = used > 0 ? `该卡有 ${used} 笔账单，删除将一并移除，确定？` : '确定删除这张信用卡？';
    if (confirm(msg)) {
      cards = cards.filter(x => x.id !== b.dataset.delCard);
      bills = bills.filter(x => x.cardId !== b.dataset.delCard);
      Store.pendingDelete.cards.push(b.dataset.delCard);
      commit();
    }
  });
  document.querySelectorAll('[data-restore-card]').forEach(b => b.onclick = () => {
    const c = cardById(b.dataset.restoreCard);
    if (c) { c.closed = false; c.closedAt = ''; c.updatedAt = Date.now(); commit(); }
  });
  document.querySelectorAll('[data-purge-card]').forEach(b => b.onclick = () => {
    if (confirm('彻底删除该已注销卡片及其账单（不可恢复）？')) {
      cards = cards.filter(x => x.id !== b.dataset.purgeCard);
      bills = bills.filter(x => x.cardId !== b.dataset.purgeCard);
      Store.pendingDelete.cards.push(b.dataset.purgeCard);
      commit();
    }
  });

  // 设置页：账户 / 拉取（注册/登录/登出在下方单独绑定）
  const pullBtn = document.getElementById('pullBtn');
  if (pullBtn) pullBtn.onclick = async () => {
    if (!Store.isCloud) { alert('请先在上方切换到「云端账户」并登录。'); return; }
    try {
      const s = await Store.load(); cards = s.cards; bills = s.bills; render();
      alert('已从云端拉取最新数据。');
    } catch (e) { alert('拉取失败：' + e.message); }
  };

  // 账户：注册 / 登录 / 登出
  const registerBtn = document.getElementById('registerBtn');
  if (registerBtn) registerBtn.onclick = async () => {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('pwInput').value;
    if (!email || !password) { alert('请填写邮箱和密码'); return; }
    try {
      const d = await Store.register(email, password);
      Store.session = d.token; Store.email = d.email;
      localStorage.setItem(LS.session, d.token); localStorage.setItem(LS.email, d.email);
      Store.mode = 'cloud'; localStorage.setItem(LS.mode, 'cloud');
      const s = await Store.save(cards, bills); // 本地数据上传到云端
      cards = s.cards; bills = s.bills;
      updateSyncState(); render();
      alert('注册成功，本地数据已上传到云端。');
    } catch (e) { alert('注册失败：' + e.message); }
  };
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.onclick = async () => {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('pwInput').value;
    if (!email || !password) { alert('请填写邮箱和密码'); return; }
    try {
      const d = await Store.login(email, password);
      Store.session = d.token; Store.email = d.email;
      localStorage.setItem(LS.session, d.token); localStorage.setItem(LS.email, d.email);
      Store.mode = 'cloud'; localStorage.setItem(LS.mode, 'cloud');
      const s = await Store.load(); cards = s.cards; bills = s.bills; // 用云端数据
      updateSyncState(); render();
      alert('登录成功，已加载云端数据。');
    } catch (e) { alert('登录失败：' + e.message); }
  };
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = async () => {
    await Store.logout();
    localStorage.setItem(LS.cards, JSON.stringify(cards));
    localStorage.setItem(LS.bills, JSON.stringify(bills));
    updateSyncState(); render();
    alert('已退出登录，数据保留在本地。');
  };

  // 导出 / 导入备份（无需后端的跨设备方案）
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.onclick = () => {
    const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cards, bills }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ccms-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  if (importBtn && importFile) {
    importBtn.onclick = () => importFile.click();
    importFile.onchange = () => {
      const f = importFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          const nc = Array.isArray(d.cards) ? d.cards : [];
          const nb = Array.isArray(d.bills) ? d.bills : [];
          if (!confirm(`将导入 ${nc.length} 张卡、${nb.length} 笔账单，并覆盖当前数据，继续？`)) { importFile.value = ''; return; }
          cards = nc.map(c => ({ ...c, closed: !!c.closed }));
          bills = nb;
          Store.pendingDelete = { cards: [], bills: [] };
          localStorage.setItem(LS.cards, JSON.stringify(cards));
          localStorage.setItem(LS.bills, JSON.stringify(bills));
          render();
          alert('导入完成，已覆盖当前数据。');
        } catch (e) {
          alert('导入失败：文件格式不正确。');
        }
        importFile.value = '';
      };
      reader.readAsText(f);
    };
  }
}

/* ------------------------------- 弹窗：信用卡 ------------------------------- */
const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function openCardModal(id) {
  const c = id ? cardById(id) : null;
  const colors = PALETTE.map(col => `<option value="${col}" ${c && c.color === col ? 'selected' : ''}>${col}</option>`).join('');
  const preview = c && c.image
    ? `<div class="img-preview" style="background-image:url('${c.image}')"></div>`
    : `<div class="img-preview">上传卡面图片（可选）</div>`;
  const html = `<div class="modal-mask" id="mask">
    <div class="modal">
      <h3>${c ? '编辑信用卡' : '新增信用卡'}</h3>
      <div class="field"><label>卡片名称</label><input id="f_name" value="${esc(c ? c.name : '')}" placeholder="如 招行经典白"></div>
      <div class="row2">
        <div class="field"><label>银行</label><input id="f_bank" value="${esc(c ? c.bank : '')}" placeholder="招商银行"></div>
        <div class="field"><label>卡号后 4 位</label><input id="f_last4" value="${esc(c ? c.last4 : '')}" maxlength="4" placeholder="1234"></div>
      </div>
      <div class="row2">
        <div class="field"><label>账单日</label><input id="f_billing" type="number" min="1" max="31" value="${esc(c ? c.billingDay : '')}" placeholder="5"></div>
        <div class="field"><label>还款日</label><input id="f_due" type="number" min="1" max="31" value="${esc(c ? c.dueDay : '')}" placeholder="23"></div>
      </div>
      <div class="row2">
        <div class="field"><label>免息期（天）</label><input id="f_grace" type="number" min="0" max="90" value="${esc(c ? c.gracePeriod : '')}" placeholder="50"></div>
        <div class="field"><label>信用额度</label><input id="f_limit" type="number" value="${esc(c ? c.limit : '')}" placeholder="50000"></div>
      </div>
      <div class="field"><label>颜色标签</label><select id="f_color">${colors}</select></div>
      <div class="field">
        <label>卡面图片（本地上传 或 图床链接，二选一）</label>
        ${preview}
        <div class="file-row" style="margin-top:8px">
          <input id="f_image" type="file" accept="image/*">
          <button class="btn sm" id="f_imgclear" type="button">清除</button>
        </div>
        <div style="margin-top:8px">
          <input id="f_imgurl" placeholder="或粘贴图床图片链接（https://...）" value="${c && c.image && /^https?:\/\//.test(c.image) ? esc(c.image) : ''}" style="width:100%">
        </div>
      </div>
      <div class="field">
        <label class="switch"><input type="checkbox" id="f_closed" ${c && c.closed ? 'checked' : ''}> 已注销（移至「已注销」模块）</label>
      </div>
      <div class="field" id="closedAtWrap" style="display:${c && c.closed ? 'block' : 'none'}">
        <label>注销日期</label><input id="f_closedAt" type="date" value="${esc(c ? c.closedAt : '')}">
      </div>
      <div class="modal-actions">
        <button class="btn" id="cancelBtn">取消</button>
        <button class="btn primary" id="saveBtn">保存</button>
      </div>
    </div>
  </div>`;
  document.getElementById('modalRoot').innerHTML = html;
  let imgData = c ? c.image || '' : '';

  const close = () => document.getElementById('modalRoot').innerHTML = '';
  document.getElementById('cancelBtn').onclick = close;
  document.getElementById('mask').onclick = e => { if (e.target.id === 'mask') close(); };
  document.getElementById('f_image').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('图片建议小于 2MB'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      imgData = reader.result;
      const urlInput = document.getElementById('f_imgurl');
      if (urlInput) urlInput.value = '';
      const pv = document.querySelector('.img-preview');
      pv.style.backgroundImage = `url('${imgData}')`;
      pv.textContent = '';
    };
    reader.readAsDataURL(file);
  };
  const imgUrlInput = document.getElementById('f_imgurl');
  if (imgUrlInput) imgUrlInput.oninput = () => {
    const v = imgUrlInput.value.trim();
    if (!v) return;
    if (!/^https?:\/\//.test(v)) return;
    imgData = v;
    const fileInput = document.getElementById('f_image');
    if (fileInput) fileInput.value = '';
    const pv = document.querySelector('.img-preview');
    pv.style.backgroundImage = `url('${v}')`;
    pv.textContent = '';
  };
  document.getElementById('f_imgclear').onclick = () => {
    imgData = '';
    const pv = document.querySelector('.img-preview');
    pv.style.backgroundImage = '';
    pv.textContent = '上传卡面图片（可选）';
    const urlInput = document.getElementById('f_imgurl');
    if (urlInput) urlInput.value = '';
    const fileInput = document.getElementById('f_image');
    if (fileInput) fileInput.value = '';
  };
  document.getElementById('f_closed').onchange = e => {
    document.getElementById('closedAtWrap').style.display = e.target.checked ? 'block' : 'none';
  };
  document.getElementById('saveBtn').onclick = () => {
    const name = document.getElementById('f_name').value.trim();
    if (!name) { alert('请填写卡片名称'); return; }
    const closed = document.getElementById('f_closed').checked;
    const data = {
      name,
      bank: document.getElementById('f_bank').value.trim(),
      last4: document.getElementById('f_last4').value.trim(),
      billingDay: document.getElementById('f_billing').value,
      dueDay: document.getElementById('f_due').value,
      gracePeriod: document.getElementById('f_grace').value,
      limit: document.getElementById('f_limit').value || 0,
      color: document.getElementById('f_color').value,
      image: imgData,
      closed,
      closedAt: closed ? (document.getElementById('f_closedAt').value || '') : '',
      updatedAt: Date.now(),
    };
    if (c) Object.assign(c, data);
    else cards.push({ id: uid(), ...data });
    close(); commit();
  };
}

/* ------------------------------- 弹窗：账单 ------------------------------- */
function openBillModal(id, presetCardId) {
  const b = id ? bills.find(x => x.id === id) : null;
  if (cards.length === 0) { alert('请先在「信用卡」中添加卡片'); return; }
  const cardId = b ? b.cardId : (presetCardId || (activeCards()[0] && activeCards()[0].id) || cards[0].id);
  const cardOpts = cards.map(c =>
    `<option value="${c.id}" ${c.id === cardId ? 'selected' : ''}>${esc(c.name)}${c.closed ? '（已注销）' : ''}</option>`).join('');
  const ym = b ? b.period : monthKey(sel.year, sel.month);
  const dueInit = b ? b.dueDate : autoDueDate(cardById(cardId), ym);
  const html = `<div class="modal-mask" id="mask">
    <div class="modal">
      <h3>${b ? '编辑账单' : '录入账单'}</h3>
      <div class="row2">
        <div class="field"><label>信用卡</label><select id="b_card">${cardOpts}</select></div>
        <div class="field"><label>账单月份</label><input id="b_period" value="${esc(ym)}" placeholder="YYYY-MM"></div>
      </div>
      <div class="row2">
        <div class="field"><label>本期账单金额</label><input id="b_stmt" type="number" step="0.01" value="${esc(b ? b.statement : '')}" placeholder="0.00"></div>
        <div class="field"><label>已还金额</label><input id="b_paid" type="number" step="0.01" value="${esc(b ? b.paid : '0')}" placeholder="0.00"></div>
      </div>
      <div class="row2">
        <div class="field"><label>还款状态</label>
          <select id="b_status">
            <option value="unpaid" ${b && b.status === 'unpaid' ? 'selected' : ''}>未还</option>
            <option value="paid" ${b && b.status === 'paid' ? 'selected' : ''}>已还</option>
            <option value="min" ${b && b.status === 'min' ? 'selected' : ''}>最低还款</option>
          </select>
        </div>
        <div class="field"><label>还款日</label>
          <div class="file-row">
            <input id="b_due" type="date" value="${esc(dueInit)}">
            <button class="btn sm" id="b_autodue" type="button" title="按卡片设置自动生成">自动</button>
          </div>
        </div>
      </div>
      <div class="field"><label>备注</label><input id="b_note" value="${esc(b ? b.note : '')}" placeholder="可选"></div>
      <div class="modal-actions">
        <button class="btn" id="cancelBtn">取消</button>
        <button class="btn primary" id="saveBtn">保存</button>
      </div>
    </div>
  </div>`;
  document.getElementById('modalRoot').innerHTML = html;
  const close = () => document.getElementById('modalRoot').innerHTML = '';
  document.getElementById('cancelBtn').onclick = close;
  document.getElementById('mask').onclick = e => { if (e.target.id === 'mask') close(); };
  document.getElementById('b_autodue').onclick = () => {
    const cid = document.getElementById('b_card').value;
    const period = document.getElementById('b_period').value.trim();
    const due = autoDueDate(cardById(cid), period);
    if (due) document.getElementById('b_due').value = due;
    else alert('请先设置卡片的账单日/还款日');
  };
  document.getElementById('saveBtn').onclick = () => {
    const period = document.getElementById('b_period').value.trim();
    if (!/^\d{4}-\d{2}$/.test(period)) { alert('账单月份格式应为 YYYY-MM'); return; }
    const data = {
      cardId: document.getElementById('b_card').value,
      period,
      statement: document.getElementById('b_stmt').value || 0,
      paid: document.getElementById('b_paid').value || 0,
      status: document.getElementById('b_status').value,
      dueDate: document.getElementById('b_due').value,
      note: document.getElementById('b_note').value.trim(),
      updatedAt: Date.now(),
    };
    if (b) Object.assign(b, data);
    else bills.push({ id: uid(), ...data });
    close(); commit();
  };
}

/* ------------------------------- 提交（持久化） ------------------------------- */
async function commit() {
  try {
    const s = await Store.save(cards, bills);
    cards = s.cards; bills = s.bills;
    render();
  } catch (e) {
    alert('保存失败：' + e.message);
  }
}

/* ------------------------------- 示例 / 清空 ------------------------------- */
function seedSample() {
  if (cards.length || bills.length) {
    if (!confirm('将追加一组示例数据到现有数据之后，继续？')) return;
  }
  const banks = [
    { name: '招行经典白', bank: '招商银行', last4: '8821', billingDay: 5, dueDay: 23, gracePeriod: 50, limit: 80000, color: '#0ea5e9' },
    { name: '中信颜卡', bank: '中信银行', last4: '3390', billingDay: 12, dueDay: 30, gracePeriod: 50, limit: 50000, color: '#f59e0b' },
    { name: '建行生活卡', bank: '建设银行', last4: '6677', billingDay: 18, dueDay: 8, gracePeriod: 48, limit: 30000, color: '#10b981' },
  ];
  const newCards = banks.map(b => ({ id: uid(), closed: false, closedAt: '', image: '', updatedAt: Date.now(), ...b }));
  cards.push(...newCards);

  const base = now.getFullYear();
  const sample = [];
  newCards.forEach((c, ci) => {
    for (let m = 1; m <= 12; m++) {
      if (base === now.getFullYear() && m > now.getMonth() + 1) continue;
      const stmt = Math.round((800 + ci * 400 + m * 137) * 100) / 100;
      const paid = m < now.getMonth() + 1 ? stmt : (m === now.getMonth() + 1 ? Math.round(stmt * 0.3 * 100) / 100 : 0);
      sample.push({
        id: uid(), cardId: c.id, period: monthKey(base, m),
        statement: stmt, paid,
        status: m < now.getMonth() + 1 ? 'paid' : 'unpaid',
        dueDate: autoDueDate(c, monthKey(base, m)),
        note: '', updatedAt: Date.now(),
      });
    }
  });
  const prev = base - 1;
  if (!bills.some(b => b.period.startsWith(String(prev)))) {
    newCards.forEach((c, ci) => {
      for (let m = 1; m <= 12; m++) {
        const stmt = Math.round((700 + ci * 350 + m * 120) * 100) / 100;
        sample.push({
          id: uid(), cardId: c.id, period: monthKey(prev, m),
          statement: stmt, paid: stmt, status: 'paid',
          dueDate: autoDueDate(c, monthKey(prev, m)), note: '', updatedAt: Date.now(),
        });
      }
    });
  }
  bills.push(...sample);
  commit();
}

async function resetAll() {
  if (!confirm('将清空所有信用卡与账单数据（不可恢复），确定？')) return;
  if (Store.isCloud) {
    Store.pendingDelete.cards.push(...cards.map(c => c.id));
    Store.pendingDelete.bills.push(...bills.map(b => b.id));
  }
  cards = []; bills = [];
  await commit();
}

/* ------------------------------- 初始化 ------------------------------- */
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });
document.getElementById('seedBtn').onclick = seedSample;
document.getElementById('resetBtn').onclick = resetAll;

// 云端模式下：窗口重新聚焦 / 页面重新可见时，自动拉取云端最新数据（多设备实时同步）
let pullTimer = null;
async function autoPull() {
  if (!Store.isCloud) return;
  try {
    const s = await Store.load();
    cards = s.cards; bills = s.bills;
    render();
  } catch (e) { /* 静默失败，下次聚焦再试 */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoPull(); });
window.addEventListener('focus', () => { clearTimeout(pullTimer); pullTimer = setTimeout(autoPull, 800); });

// 注册 Service Worker（PWA 安装 / 离线可用）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 忽略：本地 file:// 等环境不支持 */ });
  });
}

(async function init() {
  try {
    const s = await Store.load(); // 登录态下(isCloud)自动拉取云端；否则读本地
    cards = s.cards; bills = s.bills;
  } catch (e) {
    console.error(e);
    alert('数据加载失败：' + e.message + '\n（若已启用云端账户，请确认已部署 Worker 与 D1）');
  }
  updateSyncState();
  render();
})();
