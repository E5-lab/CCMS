/* =========================================================================
 * CCMS · 视图渲染与事件绑定
 * 依赖：util.js、store.js（Store）、modals.js（open* / commit）。
 * 全局状态 cards / bills / view / sel / now 在 app.js 声明。
 * ========================================================================= */

const TITLES = {
  dashboard: '概览', cards: '信用卡', closed: '已注销', monthly: '月度账单',
  annual: '年度汇总', history: '历年汇总', settings: '设置',
};

function render() {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('pageTitle').textContent = TITLES[view];
  renderAccountArea();   // 右上角账户区（主流站点布局）
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
  const bg = imgCss(c.image)
    ? `background-image:${imgCss(c.image)};background-size:cover;background-position:center`
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
    const bg = imgCss(c.image) ? `background-image:${imgCss(c.image)};background-size:cover;background-position:center` : `background:${esc(c.color || '#4f46e5')}`;
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
    el.textContent = '云端账户';
    el.classList.add('remote');
  } else {
    el.textContent = '本地存储';
    el.classList.remove('remote');
  }
}

// 右上角账户区：登录态显示账户头像+邮箱+下拉菜单；未登录显示「登录/注册」入口
function renderAccountArea() {
  const el = document.getElementById('accountArea');
  if (!el) return;
  if (Store.isCloud) {
    const initial = (Store.email || '?').trim().charAt(0).toUpperCase() || '?';
    el.innerHTML = `<div class="account-chip" id="acChip">
        <span class="account-avatar">${esc(initial)}</span>
        <span class="account-email">${esc(Store.email)}</span>
        <span class="account-caret">▾</span>
      </div>
      <div class="account-menu" id="acMenu" style="display:none">
        <button id="acSettings">账户设置</button>
        <button id="acLogout">退出登录</button>
      </div>`;
    const chip = document.getElementById('acChip');
    const menu = document.getElementById('acMenu');
    chip.onclick = (e) => { e.stopPropagation(); menu.style.display = (menu.style.display === 'none') ? 'block' : 'none'; };
    document.getElementById('acSettings').onclick = () => { view = 'settings'; render(); };
    document.getElementById('acLogout').onclick = async () => {
      await Auth.logout(Store.session);
      Store.session = ''; Store.email = '';
      localStorage.removeItem(LS.session); localStorage.removeItem(LS.email);
      menu.style.display = 'none';
      updateSyncState(); renderAccountArea(); render();
    };
    document.addEventListener('click', () => { menu.style.display = 'none'; }, { once: true });
  } else {
    el.innerHTML = `<button class="btn sm" id="acLogin">登录 / 注册</button>`;
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
    ${loggedIn ? `<div class="setting-row" style="border:none">
      <div class="desc">开启后，每天 09:00 系统会通过浏览器推送提醒临近 3 天内还款的账单（需授予通知权限）。</div>
      <div style="display:flex;gap:10px">
        <button class="btn" id="pushBtn">开启还款提醒</button>
        <button class="btn" id="pullBtn">立即拉取</button>
      </div>
    </div>` : `<div class="setting-row" style="border:none">
      <div style="display:flex;gap:10px">
        <button class="btn" id="pullBtn">立即拉取</button>
      </div>
    </div>`}
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
      const d = await Auth.register(email, password);
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
      const d = await Auth.login(email, password);
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
}
