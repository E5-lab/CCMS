/* =========================================================================
 * CCMS · 信用卡账单管理 (demo)
 * 纯前端单页应用，数据存于 localStorage。零依赖。
 * ========================================================================= */

const LS = { cards: 'ccms.cards.v1', bills: 'ccms.bills.v1' };

// ----------------------------- 状态 -----------------------------
let cards = load(LS.cards, []);
let bills = load(LS.bills, []);
let view = 'dashboard';
const now = new Date();
const sel = { year: now.getFullYear(), month: now.getMonth() + 1 };

// ----------------------------- 工具 -----------------------------
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function save() {
  localStorage.setItem(LS.cards, JSON.stringify(cards));
  localStorage.setItem(LS.bills, JSON.stringify(bills));
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

// ----------------------------- 渲染路由 -----------------------------
const TITLES = { dashboard: '概览', cards: '信用卡', monthly: '月度账单', annual: '年度汇总', history: '历年汇总' };

function render() {
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('pageTitle').textContent = TITLES[view];
  const root = document.getElementById('viewRoot');
  const actions = document.getElementById('topActions');
  actions.innerHTML = '';

  if (view === 'dashboard') root.innerHTML = renderDashboard();
  else if (view === 'cards') { root.innerHTML = renderCards(); renderCardsActions(actions); }
  else if (view === 'monthly') { root.innerHTML = renderMonthly(); renderMonthlyControls(actions); }
  else if (view === 'annual') { root.innerHTML = renderAnnual(); renderYearControls(actions); }
  else if (view === 'history') root.innerHTML = renderHistory();

  bindViewEvents();
}

// ----------------------------- 概览 -----------------------------
function renderDashboard() {
  const ym = monthKey(sel.year, sel.month);
  const monthBills = bills.filter(b => b.period === ym);
  const monthTotal = monthBills.reduce((s, b) => s + (Number(b.statement) || 0), 0);
  const monthUnpaid = monthBills
    .filter(b => b.status !== 'paid')
    .reduce((s, b) => s + ((Number(b.statement) || 0) - (Number(b.paid) || 0)), 0);

  // 最近待还（按还款日升序，未还优先）
  const upcoming = bills
    .filter(b => b.status !== 'paid' && b.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  const totalLimit = cards.reduce((s, c) => s + (Number(c.limit) || 0), 0);
  const yearTotal = bills
    .filter(b => b.period.startsWith(String(sel.year)))
    .reduce((s, b) => s + (Number(b.statement) || 0), 0);

  const stats = [
    { label: '信用卡数量', value: cards.length, sub: `总额度 ${money(totalLimit)}` },
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
        <td>${b.period}</td>
        <td>${money(b.statement)}</td>
        <td>${money(b.paid)}</td>
        <td>${esc(b.dueDate)}</td>
        <td><span class="badge ${statusClass(b.status)}">${statusText(b.status)}</span></td>
      </tr>`;
    }).join('');
    html += `</tbody></table>`;
  }
  html += `</div>`;
  return html;
}

// ----------------------------- 信用卡 -----------------------------
function renderCards() {
  if (cards.length === 0) {
    return `<div class="empty"><div class="big">💳</div>还没有信用卡，点击右上角「新增信用卡」开始</div>`;
  }
  const items = cards.map(c => {
    const used = bills.filter(b => b.cardId === c.id).length;
    return `<div class="cc-card" style="background:${esc(c.color || '#4f46e5')}">
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
        <div class="cc-meta">账单日 ${esc(c.billingDay)} · 还款日 ${esc(c.dueDay)} · 额度 ${money(c.limit)} · ${used} 笔账单</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="card-list">${items}</div>`;
}
function renderCardsActions(actions) {
  actions.innerHTML = `<button class="btn primary" id="addCardBtn">+ 新增信用卡</button>`;
}

// ----------------------------- 月度账单 -----------------------------
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
  if (cards.length === 0) {
    return `<div class="empty"><div class="big">💳</div>请先在「信用卡」中添加卡片</div>`;
  }
  const rows = cards.map(c => {
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
      <td>${money(b.statement)}</td>
      <td>${money(b.paid)}</td>
      <td>${money(remain)}</td>
      <td>${esc(b.dueDate || '—')}</td>
      <td><span class="badge ${statusClass(b.status)}">${statusText(b.status)}</span></td>
      <td>
        <button class="btn sm" data-edit-bill="${b.id}">编辑</button>
        <button class="btn sm danger" data-del-bill="${b.id}">删除</button>
      </td>
    </tr>`;
  }).join('');

  const totalStmt = cards.reduce((s, c) => {
    const b = bills.find(x => x.cardId === c.id && x.period === ym);
    return s + (b ? Number(b.statement) || 0 : 0);
  }, 0);
  const totalPaid = cards.reduce((s, c) => {
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

// ----------------------------- 年度汇总 -----------------------------
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

  // 各卡合计
  const byCard = {};
  yb.forEach(b => { byCard[b.cardId] = (byCard[b.cardId] || 0) + (Number(b.statement) || 0); });
  const cardRows = cards.filter(c => byCard[c.id] != null)
    .map(c => `<tr>
      <td><span class="dot" style="background:${esc(c.color || '#4f46e5')}"></span>${esc(c.name)}</td>
      <td>${money(byCard[c.id])}</td>
      <td>${yb.filter(b => b.cardId === c.id).length} 笔</td>
    </tr>`).join('') ||
    `<tr><td colspan="3" class="muted">无</td></tr>`;

  // 月度走势（1-12 月）
  const monthly = Array(12).fill(0);
  yb.forEach(b => {
    const m = parseInt(b.period.split('-')[1], 10);
    monthly[m - 1] += Number(b.statement) || 0;
  });

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

// ----------------------------- 历年汇总 -----------------------------
function renderHistory() {
  const years = [...new Set(bills.map(b => b.period.slice(0, 4)))].sort();
  if (years.length === 0) {
    return `<div class="empty"><div class="big">🗂️</div>暂无历史账单数据</div>`;
  }
  const data = years.map(y => {
    const yb = bills.filter(b => b.period.startsWith(y));
    const total = yb.reduce((s, b) => s + (Number(b.statement) || 0), 0);
    const cardsUsed = new Set(yb.map(b => b.cardId)).size;
    return { y, total, count: yb.length, cardsUsed };
  });

  const rows = data.map(d => `<tr>
    <td>${d.y} 年</td>
    <td>${money(d.total)}</td>
    <td>${d.count} 笔</td>
    <td>${d.cardsUsed} 张</td>
  </tr>`).join('');

  const totals = data.map(d => d.total);

  let html = `<div class="panel"><div class="panel-title">历年账单总览</div>
    <table><thead><tr><th>年份</th><th>年度账单总额</th><th>账单笔数</th><th>涉及卡片</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  html += `<div class="panel"><div class="panel-title">历年对比</div>
    ${barChart(totals, data.map(d => d.y + '年'), money)}</div>`;
  return html;
}

// ----------------------------- SVG 柱状图 -----------------------------
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
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e6e8ef"></line>
    ${bars}
  </svg></div>`;
}

// ----------------------------- 下拉选项 -----------------------------
function yearOptions(selY) {
  const years = [...new Set([...bills.map(b => +b.period.slice(0, 4)), selY, now.getFullYear()])].sort((a, b) => b - a);
  return years.map(y => `<option value="${y}" ${y === selY ? 'selected' : ''}>${y} 年</option>`).join('');
}
function monthOptions(selM) {
  return Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => `<option value="${m}" ${m === selM ? 'selected' : ''}>${m} 月</option>`).join('');
}

// ----------------------------- 事件绑定 -----------------------------
function bindViewEvents() {
  // 月度/年度 年份/月份选择
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

  document.querySelectorAll('[data-add-bill]').forEach(b =>
    b.onclick = () => openBillModal(null, b.dataset.addBill));
  document.querySelectorAll('[data-edit-bill]').forEach(b =>
    b.onclick = () => openBillModal(b.dataset.editBill));
  document.querySelectorAll('[data-del-bill]').forEach(b =>
    b.onclick = () => { if (confirm('确定删除这笔账单？')) { bills = bills.filter(x => x.id !== b.dataset.delBill); save(); render(); } });
  document.querySelectorAll('[data-edit-card]').forEach(b =>
    b.onclick = () => openCardModal(b.dataset.editCard));
  document.querySelectorAll('[data-del-card]').forEach(b =>
    b.onclick = () => {
      const c = cardById(b.dataset.delCard);
      const used = bills.filter(x => x.cardId === b.dataset.delCard).length;
      const msg = used > 0 ? `该卡有 ${used} 笔账单，删除将一并移除，确定？` : '确定删除这张信用卡？';
      if (confirm(msg)) {
        cards = cards.filter(x => x.id !== b.dataset.delCard);
        bills = bills.filter(x => x.cardId !== b.dataset.delCard);
        save(); render();
      }
    });
}

// ----------------------------- 弹窗：信用卡 -----------------------------
const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function openCardModal(id) {
  const c = id ? cardById(id) : null;
  const colors = PALETTE.map(col =>
    `<option value="${col}" ${c && c.color === col ? 'selected' : ''}>${col}</option>`).join('');
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
        <div class="field"><label>信用额度</label><input id="f_limit" type="number" value="${esc(c ? c.limit : '')}" placeholder="50000"></div>
        <div class="field"><label>颜色</label><select id="f_color">${colors}</select></div>
      </div>
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
  document.getElementById('saveBtn').onclick = () => {
    const name = document.getElementById('f_name').value.trim();
    if (!name) { alert('请填写卡片名称'); return; }
    const data = {
      name,
      bank: document.getElementById('f_bank').value.trim(),
      last4: document.getElementById('f_last4').value.trim(),
      billingDay: document.getElementById('f_billing').value,
      dueDay: document.getElementById('f_due').value,
      limit: document.getElementById('f_limit').value || 0,
      color: document.getElementById('f_color').value,
    };
    if (c) { Object.assign(c, data); } else { cards.push({ id: uid(), ...data }); }
    save(); close(); render();
  };
}

// ----------------------------- 弹窗：账单 -----------------------------
function openBillModal(id, presetCardId) {
  const b = id ? bills.find(x => x.id === id) : null;
  const cardId = b ? b.cardId : (presetCardId || (cards[0] && cards[0].id) || '');
  if (!cards.length) { alert('请先在「信用卡」中添加卡片'); return; }
  const cardOpts = cards.map(c =>
    `<option value="${c.id}" ${c.id === cardId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const ym = b ? b.period : monthKey(sel.year, sel.month);
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
        <div class="field"><label>还款日</label><input id="b_due" type="date" value="${esc(b ? b.dueDate : '')}"></div>
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
    };
    if (b) { Object.assign(b, data); } else { bills.push({ id: uid(), ...data }); }
    save(); close(); render();
  };
}

// ----------------------------- 示例数据 / 清空 -----------------------------
function seedSample() {
  if (cards.length || bills.length) {
    if (!confirm('将追加一组示例数据到现有数据之后，继续？')) return;
  }
  const banks = [
    { name: '招行经典白', bank: '招商银行', last4: '8821', billingDay: 5, dueDay: 23, limit: 80000, color: '#0ea5e9' },
    { name: '中信颜卡', bank: '中信银行', last4: '3390', billingDay: 12, dueDay: 30, limit: 50000, color: '#f59e0b' },
    { name: '建行生活卡', bank: '建设银行', last4: '6677', billingDay: 18, dueDay: 8, limit: 30000, color: '#10b981' },
  ];
  const newCards = banks.map(b => ({ id: uid(), ...b }));
  cards.push(...newCards);

  const base = now.getFullYear();
  const sample = [];
  newCards.forEach((c, ci) => {
    for (let m = 1; m <= 12; m++) {
      if (base === now.getFullYear() && m > now.getMonth() + 1) continue;
      const stmt = Math.round((800 + ci * 400 + m * 137) * 100) / 100;
      sample.push({
        id: uid(),
        cardId: c.id,
        period: monthKey(base, m),
        statement: stmt,
        paid: m < now.getMonth() + 1 ? stmt : (m === now.getMonth() + 1 ? Math.round(stmt * 0.3 * 100) / 100 : 0),
        status: m < now.getMonth() + 1 ? 'paid' : (m === now.getMonth() + 1 ? 'unpaid' : 'unpaid'),
        dueDate: `${base}-${pad2(m)}-${pad2(c.dueDay > 28 ? 28 : c.dueDay)}`,
        note: '',
      });
    }
  });
  // 补上一年少量数据，便于「历年汇总」演示
  const prev = base - 1;
  if (!bills.some(b => b.period.startsWith(String(prev)))) {
    newCards.forEach((c, ci) => {
      for (let m = 1; m <= 12; m++) {
        const stmt = Math.round((700 + ci * 350 + m * 120) * 100) / 100;
        sample.push({
          id: uid(), cardId: c.id, period: monthKey(prev, m),
          statement: stmt, paid: stmt, status: 'paid',
          dueDate: `${prev}-${pad2(m)}-${pad2(c.dueDay > 28 ? 28 : c.dueDay)}`, note: '',
        });
      }
    });
  }
  bills.push(...sample);
  save(); render();
}

// ----------------------------- 初始化 -----------------------------
document.querySelectorAll('.nav-item').forEach(b =>
  b.onclick = () => { view = b.dataset.view; render(); });

document.getElementById('seedBtn').onclick = seedSample;
document.getElementById('resetBtn').onclick = () => {
  if (confirm('将清空所有信用卡与账单数据，且不可恢复，确定？')) {
    cards = []; bills = []; save(); render();
  }
};

render();
