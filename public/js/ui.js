/* =========================================================================
 * CCMS · 视图渲染与事件绑定
 * 依赖：util.js、store.js（Store）、modals.js（open* / commit）。
 * 全局状态 cards / bills / view / sel / now 在 app.js 声明。
 * ========================================================================= */

const TITLES = {
  dashboard: t('overview'), cards: t('cards'), bills: t('billsNav'),
  benefits: t('benefitsNav'), settings: t('settings'),
};

// 统一空状态：图标 + 说明文字（避免各处硬编码 emoji）
function emptyState(icon, text) {
  return `<div class="empty"><span class="empty-ico">${svgIcon(icon, '', 22)}</span><div class="empty-text">${text}</div></div>`;
}

function render() {
  const navText = { dashboard: t('overview'), cards: t('cards'), bills: t('billsNav'), benefits: t('benefitsNav'), settings: t('settings') };
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
    // 只更新标签文本，避免覆盖图标（图标仅在首次渲染时注入一次）
    const lab = b.querySelector('.nav-label'); if (lab) lab.textContent = navText[b.dataset.view];
    const ico = b.querySelector('.nav-ico'); if (ico && !ico.firstChild) ico.innerHTML = svgIcon(b.dataset.view);
  });
  const brandLogo = document.getElementById('brandLogo');
  if (brandLogo && !brandLogo.firstChild) brandLogo.innerHTML = svgIcon('cards');
  document.getElementById('pageTitle').textContent = navText[view];
  renderAccountArea();   // 右上角账户区（主流站点布局）
  const root = document.getElementById('viewRoot');
  const actions = document.getElementById('topActions');
  actions.innerHTML = '';

  if (view === 'dashboard') root.innerHTML = renderDashboard();
  else if (view === 'cards') { root.innerHTML = renderCards(); renderCardsActions(actions); }
  else if (view === 'bills') { root.innerHTML = renderBills(); renderBillsActions(actions); }
  else if (view === 'benefits') root.innerHTML = renderBenefits();
  else if (view === 'settings') root.innerHTML = renderSettings();

  bindViewEvents();
}

/* ------------------------------- 概览 ------------------------------- */
function dueRow(d) {
  const remain = (Number(d.b.statement) || 0) - (Number(d.b.paid) || 0);
  const c = d.c || { name: t('cards'), bank: '', color: '#4f46e5' };
  const tag = d.tone === 'overdue' ? `<span class="due-tag ov">${t('overdueTag').replace('{n}', -d.days)}</span>`
    : d.tone === 'soon' ? `<span class="due-tag sn">${t('soonTag').replace('{n}', d.days)}</span>`
    : `<span class="due-tag ok">${t('laterTag').replace('{n}', d.days)}</span>`;
  return `<div class="due-row ${d.tone}">
    <span class="due-k" style="background:${esc(c.color || '#4f46e5')}">${esc((c.bank || '').slice(0, 2) || '卡')}</span>
    <span class="due-mid"><span class="due-nm">${esc(c.name)}</span><span class="due-mt">${esc(d.b.period)} · ${t('paid')} ${money(d.b.paid)}</span></span>
    <span class="due-rt"><span class="due-am">${money(remain)}</span>${tag}</span>
    <button class="due-ck" data-pay-bill="${esc(d.b.id)}" title="${t('markPaid')}" aria-label="${t('markPaid')}">${svgIcon('check', '', 13)}</button>
  </div>`;
}

function renderDashboard() {
  const y = sel.year, m = sel.month;
  const ym = monthKey(y, m);
  const monthBills = bills.filter(b => b.period === ym);
  const monthTotal = monthBills.reduce((s, b) => s + (Number(b.statement) || 0), 0);
  const monthUnpaid = monthBills.filter(b => b.status !== 'paid').reduce((s, b) => s + ((Number(b.statement) || 0) - (Number(b.paid) || 0)), 0);

  const act = activeCards();
  const usage = totalUsage(act); // 整体额度使用率（已用/总授信）
  const yearTotal = bills.filter(b => b.period.startsWith(String(y))).reduce((s, b) => s + (Number(b.statement) || 0), 0);

  // 临近 / 逾期账单分组（唯一真源 billTone）
  const due = bills.filter(b => b.status !== 'paid' && b.dueDate)
    .map(b => ({ b, c: cardById(b.cardId), tone: billTone(b), days: daysUntil(b.dueDate) }))
    .filter(d => d.days != null)
    .sort((a, b) => a.days - b.days);
  const overdue = due.filter(d => d.tone === 'overdue');
  const soon = due.filter(d => d.tone === 'soon');
  const later = due.filter(d => d.tone === 'normal');
  const maxOverdue = overdue.length ? Math.max(...overdue.map(d => -d.days)) : 0;
  const next = due.length ? due[0] : null; // 最紧急（逾期优先）
  const change = monthChange(y, m);

  const stats = [
    { label: t('activeCards'), value: String(act.length), sub: `${t('totalLimit')} ${money(usage.limit)} · ${t('used')} ${usage.pct}%`, icon: 'cards', tone: 'indigo' },
    { label: `${y}${t('monthBill')}`, value: money(monthTotal), sub: `${t('unpaid')} ${money(monthUnpaid)}${change != null ? ` · ${change >= 0 ? '+' : '−'}${money(Math.abs(change))}` : ''}`, icon: 'calendar', tone: 'violet' },
    { label: `${y}${t('yearBill')}`, value: money(yearTotal), sub: `${t('avgMonth')} ${money(avgMonth(y))}`, icon: 'trend', tone: 'teal' },
    { label: t('overdueTitle'), value: String(overdue.length), sub: overdue.length ? `${t('maxOverdue')} ${maxOverdue}${t('days')}` : t('noOverdue'), icon: 'warn', tone: 'amber', danger: overdue.length > 0 },
  ];

  // 下一个还款日 hero（含整体额度使用率环图）
  let hero;
  if (next) {
    const nd = next.days;
    const remain = (Number(next.b.statement) || 0) - (Number(next.b.paid) || 0);
    const ht = next.tone === 'overdue' ? 'overdue' : (next.tone === 'soon' ? 'soon' : 'normal');
    const big = next.tone === 'overdue' ? t('overdueDayCount').replace('{n}', -nd) : t('daysCount').replace('{n}', nd);
    hero = `<div class="dash-hero tone-${ht}">
      <div class="dh-left">
        <div class="dh-lab">${t('nextDue')} · ${esc(next.c ? next.c.name : '已删卡')}</div>
        <div class="dh-big">${big}</div>
        <div class="dh-amt">${money(remain)} · ${esc(next.b.dueDate)}</div>
      </div>
      <div class="dh-ring" style="--p:${usage.pct}"><div class="ring-i">${usage.pct}<span>%</span></div></div>
      <div class="dh-sp">
        <div class="dh-sp-t">${t('usageRate')}</div>
        <div class="dh-sp-v">${t('used')} ${money(usage.used)}</div>
        <div class="dh-sp-s">${t('available')} ${money(Math.max(0, usage.limit - usage.used))} / ${money(usage.limit)}</div>
      </div>
    </div>`;
  } else {
    hero = `<div class="dash-hero tone-none">
      <div class="dh-left">
        <div class="dh-lab">${t('nextDue')}</div>
        <div class="dh-big">${t('allPaid')}</div>
        <div class="dh-amt">${t('noDue')}</div>
      </div>
      <div class="dh-ring" style="--p:${usage.pct}"><div class="ring-i">${usage.pct}<span>%</span></div></div>
      <div class="dh-sp">
        <div class="dh-sp-t">${t('usageRate')}</div>
        <div class="dh-sp-v">${t('used')} ${money(usage.used)}</div>
        <div class="dh-sp-s">${t('available')} ${money(Math.max(0, usage.limit - usage.used))} / ${money(usage.limit)}</div>
      </div>
    </div>`;
  }

  // 待还清款分组列表
  const duePanel = `<div class="panel">
    <div class="panel-head"><div class="panel-title">${t('recentDue')}</div><span class="panel-hint">${due.length ? due.length + ' ' + t('bills') : ''}</span></div>
    ${overdue.length ? `<div class="due-grp">${t('grpOverdue')}</div>` + overdue.map(dueRow).join('') : ''}
    ${soon.length ? `<div class="due-grp">${t('grpSoon')}</div>` + soon.map(dueRow).join('') : ''}
    ${later.length ? `<div class="due-grp">${t('grpLater')}</div>` + later.map(dueRow).join('') : ''}
    ${!due.length ? emptyState('check', t('noDue')) : ''}
    <div class="due-foot">${t('totalUnpaid')} <b>${money(monthUnpaid)}</b> · ${due.length} ${t('bills')} · ${t('totalPoints')} <b>${totalPoints(act)}</b></div>
  </div>`;

  // 各卡额度使用率
  const usagePanel = `<div class="panel">
    <div class="panel-head"><div class="panel-title">${t('usagePerCard')}</div></div>
    ${act.map(c => { const u = usageOf(c); const ov = u.pct >= 70; return `<div class="usg-row">
      <span class="usg-k" style="background:${esc(c.color || '#4f46e5')}"></span>
      <span class="usg-nm">${esc(c.name)}</span>
      <span class="usg-pg"><span class="usg-pi ${ov ? 'ov' : ''}" style="width:${u.pct}%"></span></span>
      <span class="usg-pv ${ov ? 'ov' : ''}">${u.pct}%</span>
    </div>`; }).join('') || `<div class="muted">${t('noCard')}</div>`}
  </div>`;

  // 月度走势：当前月之后的月份填 null（未到账期）
  const chartVals = Array(12).fill(0).map((_, i) => ((i + 1) > m && y === now.getFullYear()) ? null : 0);
  bills.filter(b => b.period.startsWith(String(y))).forEach(b => {
    const mm = parseInt(b.period.split('-')[1], 10);
    if (mm >= 1 && mm <= 12 && chartVals[mm - 1] != null) chartVals[mm - 1] += Number(b.statement) || 0;
  });
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + t('monthShort'));

  let html = `<div class="dash">
    ${hero}
    <div class="stat-grid">${stats.map(s => `
      <div class="stat-card ${s.danger ? 'tone-danger' : 'tone-' + s.tone}">
        <div class="stat-head"><span class="stat-ico">${svgIcon(s.icon)}</span><span class="label">${s.label}</span></div>
        <div class="value">${s.value}</div>
        <div class="sub">${s.sub}</div>
      </div>`).join('')}</div>
    <div class="dash-grid">
      <div class="dash-col-main">
        <div class="panel"><div class="panel-head"><div class="panel-title">${y}${t('monthTrend')}</div></div>${barChart(chartVals, labels, money, { avg: avgMonth(y) })}</div>
        ${usagePanel}
      </div>
      <div class="dash-col-side">${duePanel}</div>
    </div>
  </div>`;
  return html;
}

/* ------------------------------- 信用卡（有效） ------------------------------- */
function feeText(c) {
  if (c.annual_fee_type === 'swipe') return `刷满 ${esc(c.annual_fee_swipe || '?')} 次免年费`;
  if (c.annual_fee_type === 'points') return `${esc(c.annual_fee_points || '?')} 积分免年费`;
  if (c.annual_fee) return `年费 ${money(c.annual_fee)}`;
  return '';
}
function ccCardHtml(c, navigable) {
  const grace = c.gracePeriod ? ` · 免息 ${esc(c.gracePeriod)} 天` : '';
  const fee = feeText(c);
  const u = usageOf(c);
  const uOv = u.pct >= 70;
  const chip = (c.points != null && c.points > 0) || (c.annual_fee != null && c.annual_fee > 0)
    ? `<span class="cc-tag">${c.points != null && c.points > 0 ? t('points') + ' ' + c.points.toLocaleString('zh-CN') : feeText(c)}</span>` : '';
  return `<div class="cc-card" style="${cardFaceStyle(c)}" data-go-card="${c.id}">
    <div class="cc-overlay"></div>
    <div class="cc-chip"></div>
    <div class="cc-actions">
      <button data-edit-card="${c.id}" title="编辑" aria-label="编辑">${svgIcon('edit')}</button>
      <button data-del-card="${c.id}" title="删除" aria-label="删除">${svgIcon('trash')}</button>
    </div>
    <div class="cc-top">
      <div class="cc-bank">${esc(c.bank || '未填银行')}</div>
      ${chip}
    </div>
    <div>
      <div class="cc-num">•••• ${esc(c.last4 || '****')}</div>
    </div>
    <div>
      <div class="cc-name">${esc(c.name)}</div>
      <div class="cc-meta">账单日 ${esc(c.billingDay) || '—'} · 还款日 ${esc(c.dueDay) || '—'} · 额度 ${money(c.limit)}${grace}</div>
      ${fee ? `<div class="cc-meta">${fee}</div>` : ''}
      <div class="cc-use">
        <div class="cc-use-t"><span>${t('used')} ${u.pct}%</span><span>${t('used')} ${money(u.used)} / ${money(u.limit)}</span></div>
        <div class="cc-use-p"><span class="cc-use-i ${uOv ? 'ov' : ''}" style="width:${u.pct}%"></span></div>
      </div>
    </div>
  </div>`;
}

// 信用卡模块内的功能分区：有效卡 / 已注销（已注销是信用卡模块的子集）
function cardsSeg() {
  return `<div class="seg">
    <button data-cardtab="active" class="${cardPartition === 'active' ? 'active' : ''}">${svgIcon('cards', '', 15)}<span>${t('cardsActive')}</span></button>
    <button data-cardtab="closed" class="${cardPartition === 'closed' ? 'active' : ''}">${svgIcon('archive', '', 15)}<span>${t('cardsClosed')}</span></button>
  </div>`;
}

function renderCards() {
  if (cardPartition === 'closed') return cardsSeg() + renderClosedCards();
  const act = activeCards();
  if (act.length === 0) {
    return cardsSeg() + emptyState('cards', '还没有信用卡，点击右上角「新增信用卡」开始');
  }
  return cardsSeg() + `<div class="card-list">${act.map(ccCardHtml).join('')}</div>`;
}
function renderCardsActions(actions) {
  actions.innerHTML = `<button class="btn primary" id="addCardBtn">${t('addCard')}</button>`;
}

/* ------------------------------- 已注销（信用卡模块子分区） ------------------------------- */
function renderClosedCards() {
  const closed = cards.filter(c => c.closed);
  if (closed.length === 0) {
    return emptyState('archive', '暂无已注销的信用卡。注销的卡片会出现在这里，保留你的玩卡经历。');
  }
  const items = closed.map(c => {
    const cnt = bills.filter(b => b.cardId === c.id).length;
    return `<div class="cc-card closed-card" style="${cardFaceStyle(c)}">
      <div class="cc-overlay"></div>
    <div class="cc-chip"></div>
    <div class="cc-actions">
      <button data-restore-card="${c.id}" title="恢复" aria-label="恢复">${svgIcon('restore')}</button>
      <button data-purge-card="${c.id}" title="彻底删除" aria-label="彻底删除">${svgIcon('trash')}</button>
    </div>
      <div>
        <div class="cc-bank">${esc(c.bank || '未填银行')}</div>
        <div class="cc-num">•••• ${esc(c.last4 || '****')}</div>
      </div>
      <div>
        <div class="cc-bank">${esc(c.name)}</div>
        <div class="cc-meta">${c.closedAt ? '注销于 ' + esc(c.closedAt) : '已注销'} · 留存 ${cnt} 笔账单</div>
        <div class="cc-use">
          <div class="cc-use-t"><span>${t('used')} ${usageOf(c).pct}%</span><span>${money(usageOf(c).used)} / ${money(usageOf(c).limit)}</span></div>
          <div class="cc-use-p"><span class="cc-use-i" style="width:${usageOf(c).pct}%"></span></div>
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div class="panel"><div class="panel-title">已注销信用卡（${closed.length}）</div>
    <div class="card-list">${items}</div></div>`;
}

/* ------------------------------- 账单（月度 / 年度 同属一个模块） ------------------------------- */
function billsSeg() {
  return `<div class="seg">
    <button data-billtab="monthly" class="${billPartition === 'monthly' ? 'active' : ''}">${svgIcon('calendar', '', 15)}<span>${t('tabMonthly')}</span></button>
    <button data-billtab="annual" class="${billPartition === 'annual' ? 'active' : ''}">${svgIcon('chart', '', 15)}<span>${t('tabAnnual')}</span></button>
  </div>`;
}
function renderBills() {
  return billPartition === 'annual' ? billsSeg() + renderAnnual() : billsSeg() + renderMonthly();
}
function renderBillsActions(actions) {
  if (billPartition === 'annual') renderYearControls(actions);
  else renderMonthlyControls(actions);
}

/* ------------------------------- 状态徽章（含逾期/临期分级，P0-1 落地到表格） ------------------------------- */
function statusBadge(b) {
  if (b.status === 'paid') return `<span class="badge paid">${statusText('paid')}</span>`;
  const d = daysUntil(b.dueDate);
  if (d != null && d < 0) return `<span class="badge unpaid">${t('overdueTag').replace('{n}', -d)}</span>`;
  if (d != null && d <= 3) return `<span class="badge min">${t('soonTag').replace('{n}', d)}</span>`;
  return `<span class="badge ${statusClass(b.status)}">${statusText(b.status)}</span>`;
}

/* ------------------------------- 月度账单 ------------------------------- */
function renderMonthlyControls(actions) {
  const back = focusCardId ? `<button class="btn" id="backCardsBtn">← ${t('cards')}</button>` : '';
  actions.innerHTML = `
    <div class="controls">
      ${back}
      <select id="yearSel">${yearOptions(sel.year)}</select>
      <select id="monthSel">${monthOptions(sel.month)}</select>
      <button class="btn primary" id="addBillBtn">${t('addBill')}</button>
    </div>`;
}
function renderMonthly() {
  const ym = monthKey(sel.year, sel.month);
  let act = activeCards();
  if (focusCardId) act = act.filter(c => c.id === focusCardId);
  if (act.length === 0) {
    return emptyState('cards', '请先在「信用卡」中添加卡片');
  }
  const rows = act.map(c => {
    const b = bills.find(x => x.cardId === c.id && x.period === ym);
    if (!b) {
      return `<tr>
        <td data-label="${t('cards')}"><span class="dot" style="background:${esc(c.color || '#4f46e5')}"></span>${esc(c.name)}</td>
        <td class="muted" data-label="${t('stmtAmt')}">未录入</td><td class="muted" data-label="${t('paidAmt')}">—</td><td class="muted" data-label="${t('unpaid')}">—</td>
        <td class="muted" data-label="${t('dueDate')}">—</td><td class="muted" data-label="${t('billStatus')}">—</td>
        <td data-label=""><button class="btn sm" data-add-bill="${c.id}">录入</button></td>
      </tr>`;
    }
    const remain = (Number(b.statement) || 0) - (Number(b.paid) || 0);
    const tone = billTone(b);
    return `<tr class="due-${tone}">
      <td data-label="${t('cards')}"><span class="dot" style="background:${esc(c.color || '#4f46e5')}"></span>${esc(c.name)}</td>
      <td data-label="${t('stmtAmt')}">${money(b.statement)}</td>
      <td data-label="${t('paidAmt')}">${money(b.paid)}</td>
      <td data-label="${t('unpaid')}">${money(remain)}</td>
      <td data-label="${t('dueDate')}">${esc(b.dueDate || '—')}</td>
      <td data-label="${t('billStatus')}">${statusBadge(b)}</td>
      <td data-label="">
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
    <div class="panel-head"><div class="panel-title">${sel.year} 年 ${sel.month} 月 · 各卡账单</div></div>
    <div class="table-wrap"><table class="bill-table">
      <thead><tr><th>信用卡</th><th>本期账单</th><th>已还</th><th>待还</th><th>还款日</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>合计</td><td>${money(totalStmt)}</td><td>${money(totalPaid)}</td><td>${money(totalStmt - totalPaid)}</td><td colspan="3"></td></tr></tfoot>
    </table></div>
  </div>`;
}

/* ------------------------------- 年度汇总（含历年对比，替代原「历年汇总」） ------------------------------- */
function renderYearControls(actions) {
  actions.innerHTML = `<div class="controls"><select id="yearSel2">${yearOptions(sel.year)}</select></div>`;
}
function renderAnnual() {
  const y = String(sel.year);
  const yb = bills.filter(b => b.period.startsWith(y));
  if (yb.length === 0) {
    return emptyState('chart', `${sel.year} 年暂无账单数据`);
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
    { label: '全年账单总额', value: money(totalStmt), icon: 'trend', tone: 'indigo' },
    { label: '全年已还', value: money(totalPaid), icon: 'check', tone: 'teal' },
    { label: '涉及卡片', value: Object.keys(byCard).length + ' 张', icon: 'cards', tone: 'violet' },
    { label: '月均账单', value: money(totalStmt / 12), icon: 'chart', tone: 'amber' },
  ];

  let html = `<div class="stat-grid">` + stats.map(s =>
    `<div class="stat-card tone-${s.tone}">
      <div class="stat-head"><span class="stat-ico">${svgIcon(s.icon)}</span><span class="label">${s.label}</span></div>
      <div class="value">${s.value}</div>
    </div>`).join('') + `</div>`;

  html += `<div class="panel"><div class="panel-head"><div class="panel-title">各卡年度合计</div></div>
    <div class="table-wrap"><table><thead><tr><th>信用卡</th><th>年度账单</th><th>笔数</th></tr></thead><tbody>${cardRows}</tbody></table></div></div>`;

  html += `<div class="panel"><div class="panel-title">${sel.year} 年月度走势（账单金额）</div>
    ${barChart(monthly, ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], money)}</div>`;

  // 历年对比（合并原「历年汇总」功能，避免重复模块）
  const years = [...new Set(bills.map(b => b.period.slice(0, 4)))].sort();
  if (years.length > 1) {
    const hist = years.map(y => {
      const hb = bills.filter(b => b.period.startsWith(y));
      return { y, total: hb.reduce((s, b) => s + (Number(b.statement) || 0), 0) };
    });
    html += `<div class="panel"><div class="panel-title">历年账单总额对比</div>
      ${barChart(hist.map(d => d.total), hist.map(d => d.y + '年'), money)}</div>`;
  }
  return html;
}

/* ------------------------------- 权益专区（年费 / 机场贵宾厅 / 权益说明） ------------------------------- */
function renderBenefits() {
  const act = activeCards();
  if (act.length === 0) {
    return emptyState('benefits', '还没有有效信用卡，先在「信用卡」中添加卡片吧。');
  }
  const cardsHtml = act.map(c => `
    <div class="benefit-card">
      <div class="bc-head" style="${cardFaceStyle(c)}">
        <div class="bc-bank">${esc(c.bank || '未填银行')}</div>
        <div class="bc-name">${esc(c.name)}</div>
      </div>
      <div class="bc-body">
        <div class="bc-row"><span>${t('feeLabel')}</span><b>${esc(feeText(c) || '—')}</b></div>
        <div class="bc-row"><span>${t('loungeLabel')}</span><b>${c.lounge_count != null ? esc(c.lounge_count) + ' 次' : '—'}</b></div>
        <div class="bc-row"><span>${t('benefitsInfo')}</span><b class="bc-benefit">${esc(c.benefits || t('noBenefit'))}</b></div>
      </div>
    </div>`).join('');
  return `<div class="panel">
    <div class="panel-title">${t('benefitsNav')} · ${t('benefitsHint')}</div>
    <div class="benefit-grid">${cardsHtml}</div>
  </div>`;
}

/* ------------------------------- 设置（账户 / 同步） ------------------------------- */
function updateSyncState() {
  const el = document.getElementById('syncState');
  const pill = document.getElementById('syncPill');
  if (!el) return;
  if (Store.isCloud) {
    el.textContent = '云端账户';
    if (pill) pill.classList.add('remote');
  } else {
    el.textContent = '本地存储';
    if (pill) pill.classList.remove('remote');
  }
}

// 右上角账户区：登录态显示昵称头像 + 下拉菜单；未登录显示「登录/注册」入口
function renderAccountArea() {
  const el = document.getElementById('accountArea');
  if (!el) return;
  if (Store.isCloud) {
    const nick = getNickname() || Store.email;
    const initial = (nick || '?').trim().charAt(0).toUpperCase() || '?';
    el.innerHTML = `<div class="account-chip" id="acChip">
        <span class="account-avatar">${esc(initial)}</span>
        <span class="account-email">${esc(nick)}</span>
        <span class="account-caret">${svgIcon('chevron', '', 14)}</span>
      </div>
      <div class="account-menu" id="acMenu" style="display:none">
        <button id="acSettings">${svgIcon('settings', '', 15)}<span>${t('accountSettings')}</span></button>
        <button id="acLogout" class="danger">${svgIcon('logout', '', 15)}<span>${t('logout')}</span></button>
      </div>`;
    const chip = document.getElementById('acChip');
    const menu = document.getElementById('acMenu');
    chip.onclick = (e) => {
      e.stopPropagation();
      const open = menu.style.display === 'block';
      menu.style.display = open ? 'none' : 'block';
      chip.classList.toggle('open', !open);
    };
    document.getElementById('acSettings').onclick = () => { menu.style.display = 'none'; chip.classList.remove('open'); view = 'settings'; render(); };
    document.getElementById('acLogout').onclick = async () => {
      await Auth.logout(Store.session);
      Store.session = ''; Store.email = '';
      localStorage.removeItem(LS.session); localStorage.removeItem(LS.email);
      menu.style.display = 'none'; chip.classList.remove('open');
      updateSyncState(); renderAccountArea(); render();
    };
    setTimeout(() => document.addEventListener('click', () => { menu.style.display = 'none'; chip.classList.remove('open'); }, { once: true }), 0);
  } else {
    el.innerHTML = `<button class="btn sm" id="acLogin">${t('loginReg')}</button>`;
    document.getElementById('acLogin').onclick = () => { view = 'settings'; render(); };
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
         <button class="btn" id="logoutBtn">${t('logout')}</button>
       </div>
       <div class="setting-row">
         <div>
           <div>${t('nickname')}</div>
           <div class="desc">显示在头像与账户区，默认使用邮箱前缀。</div>
         </div>
         <div class="color-row">
           <input id="nickInput" value="${esc(getNickname())}" placeholder="${esc((Store.email || '').split('@')[0])}" style="max-width:200px">
           <button class="btn" id="saveNickBtn">${t('saveNick')}</button>
         </div>
       </div>`
    : `<div class="setting-row">
         <div>
           <div style="margin-bottom:8px">${t('email')}</div>
           <input id="emailInput" placeholder="you@example.com" style="max-width:240px" value="${esc(Store.email)}">
           <div style="margin:8px 0 4px">${t('password')}</div>
           <input id="pwInput" type="password" placeholder="至少 6 位" style="max-width:240px">
           <div class="desc" style="margin-top:6px">注册即用该邮箱+密码，无需验证码；登录后本地数据会自动上传到云端。</div>
         </div>
         <div style="display:flex;flex-direction:column;gap:10px">
           <button class="btn primary" id="registerBtn">${t('cloudStore')}</button>
           <button class="btn" id="loginBtn">${t('loginReg')}</button>
         </div>
       </div>`;
  return `<div class="panel">
    <div class="panel-title">${t('storageData')}</div>
    <div class="setting-row">
      <div>
        <div>
          <label class="switch"><input type="radio" name="mode" value="local" ${!cloud ? 'checked' : ''}> ${t('localStore')}</label>
          <label class="switch"><input type="radio" name="mode" value="cloud" ${cloud ? 'checked' : ''}> ${t('cloudStore')}</label>
        </div>
        <div class="desc">${t('localStore')}：数据仅存于当前浏览器。${t('cloudStore')}：注册/登录后在 Cloudflare D1 多设备同步，按账号隔离。</div>
      </div>
    </div>
    ${accountBlock}
    ${loggedIn ? `<div class="setting-row" style="border:none">
      <div class="desc">开启后，每天 09:00 系统会通过浏览器推送提醒临近 3 天内还款的账单（需授予通知权限）。</div>
      <div style="display:flex;gap:10px">
        <button class="btn" id="pushBtn">${t('enablePush')}</button>
        <button class="btn" id="pullBtn">${t('pullNow')}</button>
      </div>
    </div>` : `<div class="setting-row" style="border:none">
      <div style="display:flex;gap:10px">
        <button class="btn" id="pullBtn">${t('pullNow')}</button>
      </div>
    </div>`}
  </div>
  <div class="panel">
    <div class="panel-title">${t('theme')} & ${t('language')}</div>
    <div class="setting-row">
      <div>${t('theme')}</div>
      <div class="color-row">
        <label class="switch"><input type="radio" name="theme" value="light" ${getTheme() !== 'dark' ? 'checked' : ''}> ${t('light')}</label>
        <label class="switch"><input type="radio" name="theme" value="dark" ${getTheme() === 'dark' ? 'checked' : ''}> ${t('dark')}</label>
      </div>
    </div>
    <div class="setting-row" style="border:none">
      <div>${t('language')}</div>
      <select id="themeLangSel" style="width:auto">
        <option value="zh" ${lang === 'zh' ? 'selected' : ''}>${t('zh')}</option>
        <option value="en" ${lang === 'en' ? 'selected' : ''}>${t('en')}</option>
      </select>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">数据管理</div>
    <div class="desc">备份与跨设备迁移（无需云端）：导出/导入 JSON 备份文件，最简单。CSV 账单导入：把银行账单按模板批量导入。</div>
    <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
      <button class="btn" id="exportBtn">导出备份</button>
      <button class="btn" id="importBtn">导入备份</button>
      <button class="btn" id="csvBtn">导入 CSV 账单</button>
      <input id="importFile" type="file" accept="application/json,.json" style="display:none">
    </div>
  </div>
  <div class="panel danger-panel">
    <div class="panel-title">危险操作</div>
    <div class="desc">清空数据将删除本地的全部信用卡与账单（云端账户下也会同步删除），不可恢复。</div>
    <div style="margin-top:10px"><button class="btn danger" id="resetBtn">清空所有数据</button></div>
  </div>
  <div class="panel">
    <div class="panel-title">关于</div>
    <div class="desc">CCMS · 信用卡账单管理。卡面图片支持本地上传或图床链接。</div>
  </div>`;
}

/* ------------------------------- 事件绑定 ------------------------------- */
function bindViewEvents() {
  const yearSel = document.getElementById('yearSel');
  const monthSel = document.getElementById('monthSel');
  const yearSel2 = document.getElementById('yearSel2');
  if (yearSel) yearSel.onchange = e => { sel.year = +e.target.value; render(); };
  if (monthSel) monthSel.onchange = e => { sel.month = +e.target.value; render(); };
  if (yearSel2) yearSel2.onchange = e => { sel.year = +e.target.value; render(); };

  // 信用卡模块分区：有效 / 已注销
  document.querySelectorAll('[data-cardtab]').forEach(b => b.onclick = () => {
    cardPartition = b.dataset.cardtab; render();
  });
  // 账单模块分区：月度 / 年度
  document.querySelectorAll('[data-billtab]').forEach(b => b.onclick = () => {
    billPartition = b.dataset.billtab; render();
  });

  const backCardsBtn = document.getElementById('backCardsBtn');
  if (backCardsBtn) backCardsBtn.onclick = () => { focusCardId = ''; render(); };

  const addBillBtn = document.getElementById('addBillBtn');
  if (addBillBtn) addBillBtn.onclick = () => openBillModal(null);
  const addCardBtn = document.getElementById('addCardBtn');
  if (addCardBtn) addCardBtn.onclick = () => openCardModal(null);

  document.querySelectorAll('[data-add-bill]').forEach(b => b.onclick = () => openBillModal(null, b.dataset.addBill));
  document.querySelectorAll('[data-edit-bill]').forEach(b => b.onclick = () => openBillModal(b.dataset.editBill));
  document.querySelectorAll('[data-del-bill]').forEach(b => b.onclick = () => {
    if (confirm('确定删除这笔账单？')) { bills = bills.filter(x => x.id !== b.dataset.delBill); Store.pendingDelete.bills.push(b.dataset.delBill); commit(); }
  });
  // 概览页待还列表：一键标记为已还
  document.querySelectorAll('[data-pay-bill]').forEach(b => b.onclick = () => {
    const bill = bills.find(x => x.id === b.dataset.payBill);
    if (!bill) return;
    bill.status = 'paid';
    bill.paid = Number(bill.statement) || 0;
    bill.updatedAt = Date.now();
    commit();
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
      const d = await Auth.register(email, password);
      Store.session = d.token; Store.email = d.email;
      if (d.nickname) setNickname(d.nickname);
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
      const d = await Auth.login(email, password);
      Store.session = d.token; Store.email = d.email;
      if (d.nickname) setNickname(d.nickname);
      localStorage.setItem(LS.session, d.token); localStorage.setItem(LS.email, d.email);
      Store.mode = 'cloud'; localStorage.setItem(LS.mode, 'cloud');
      const s = await Store.load(); cards = s.cards; bills = s.bills; // 用云端数据
      updateSyncState(); render();
      alert('登录成功，已加载云端数据。');
    } catch (e) { alert('登录失败：' + e.message); }
  };
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = async () => {
    await Auth.logout(Store.session);
    Store.session = ''; Store.email = '';
    localStorage.removeItem(LS.session); localStorage.removeItem(LS.email);
    updateSyncState(); render();
    alert('已退出登录，云端账户下的数据保留在云端，本地副本仍在。');
  };

  // Web Push 还款提醒订阅 / 取消
  const pushBtn = document.getElementById('pushBtn');
  if (pushBtn) pushBtn.onclick = async () => {
    if (!window.VAPID_PUBLIC) { alert('本站尚未配置 Web Push 公钥，无法开启提醒。请在 Worker 环境变量中配置 VAPID 密钥（详见 README）。'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { alert('当前浏览器不支持 Web Push。'); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('未授予通知权限，无法开启提醒。'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: (window.VAPID_PUBLIC || '') });
      const raw = sub.toJSON();
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + Store.session }, body: JSON.stringify({ endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth }) });
      alert('已开启还款提醒。');
    } catch (e) { alert('开启提醒失败：' + e.message); }
  };

  // 清空数据（危险操作）
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.onclick = async () => {
    if (!confirm('将清空全部信用卡与账单（含云端），不可恢复，确定？')) return;
    if (Store.isCloud) {
      Store.pendingDelete.cards.push(...cards.map(c => c.id));
      Store.pendingDelete.bills.push(...bills.map(b => b.id));
    }
    cards = []; bills = [];
    await commit();
    alert('已清空。');
  };

  // CSV 账单导入
  const csvBtn = document.getElementById('csvBtn');
  if (csvBtn) csvBtn.onclick = () => openCsvModal();

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
          // 用统一的校验/清洗入口，避免导入恶意卡面 URL
          const v = validateBackup(d);
          const nc = v.cards, nb = v.bills;
          if (!confirm(`将导入 ${nc.length} 张卡、${nb.length} 笔账单，并覆盖当前数据，继续？`)) { importFile.value = ''; return; }
          cards = nc.map(c => ({ ...c, closed: !!c.closed }));
          bills = nb;
          Store.pendingDelete = { cards: [], bills: [] };
          localStorage.setItem(LS.cards, JSON.stringify(cards));
          localStorage.setItem(LS.bills, JSON.stringify(bills));
          render();
          alert('导入完成，已覆盖当前数据。');
        } catch (e) {
          alert('导入失败：' + e.message);
        }
        importFile.value = '';
      };
      reader.readAsText(f);
    };
  }

  // 设置页：昵称保存（云端账户同步到服务端，本地始终保存）
  const saveNickBtn = document.getElementById('saveNickBtn');
  if (saveNickBtn) saveNickBtn.onclick = async () => {
    const v = document.getElementById('nickInput').value.trim();
    if (Store.isCloud) {
      try {
        await Auth.saveNick(v);
        setNickname(v);
        renderAccountArea();
        alert('昵称已保存，并同步到云端账户（其他设备登录后自动同步）。');
      } catch (e) {
        setNickname(v); // 云端失败仍保留本地，避免丢失
        renderAccountArea();
        alert('已保存到本地；云端同步暂未生效：' + e.message + '\n（需 Worker 支持昵称接口）');
      }
    } else {
      setNickname(v);
      renderAccountArea();
      alert('昵称已保存到本地。');
    }
  };
  // 设置页：主题切换
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.onchange = () => { if (r.checked) { setTheme(r.value); updateThemeBtn(); } };
  });
  // 设置页：语言切换
  const themeLangSel = document.getElementById('themeLangSel');
  if (themeLangSel) themeLangSel.onchange = () => setLang(themeLangSel.value);

  // 卡面点击：概览页跳转月度账单（聚焦该卡）；其它页打开编辑
  document.querySelectorAll('[data-go-card]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('.cc-actions')) return; // 操作按钮不触发跳转
      const id = el.dataset.goCard;
      if (view === 'dashboard') { focusCardId = id; view = 'bills'; billPartition = 'monthly'; render(); }
      else openCardModal(id);
    };
  });
}
