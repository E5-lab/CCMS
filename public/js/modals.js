/* =========================================================================
 * CCMS · 弹窗（信用卡 / 账单 / CSV 导入）与持久化提交
 * 依赖：util.js（工具）、store.js（Store）、ui.js（render，于调用时解析）。
 * ========================================================================= */

const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

/* ------------------------------- 弹窗：信用卡 ------------------------------- */
function openCardModal(id) {
  const c = id ? cardById(id) : null;
  const colors = PALETTE.map(col => `<option value="${col}" ${c && c.color === col ? 'selected' : ''}>${col}</option>`).join('');
  const ft = c ? (c.annual_fee_type || 'amount') : 'amount';
  const preview = c && c.image
    ? `<div class="img-preview" style="background-image:${imgCss(c.image)};background-size:cover;background-position:center"></div>`
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
      <div class="row2">
        <div class="field"><label>${t('points')}</label><input id="f_points" type="number" min="0" value="${esc(c ? c.points : '')}" placeholder="如 120000"></div>
        <div class="field"><label>${t('feeType')}</label><select id="f_feetype">
          <option value="amount" ${ft === 'amount' ? 'selected' : ''}>${t('feeTypeAmount')}</option>
          <option value="swipe" ${ft === 'swipe' ? 'selected' : ''}>${t('feeTypeSwipe')}</option>
          <option value="points" ${ft === 'points' ? 'selected' : ''}>${t('feeTypePoints')}</option>
        </select></div>
      </div>
      <div class="field" id="feeAmountWrap" style="display:${ft === 'amount' ? 'block' : 'none'}"><label>${t('feeAmount')}</label><input id="f_fee" type="number" min="0" value="${esc(c ? c.annual_fee : '')}" placeholder="如 2000"></div>
      <div class="field" id="feeSwipeWrap" style="display:${ft === 'swipe' ? 'block' : 'none'}"><label>${t('feeSwipe')}</label><input id="f_feeswipe" type="number" min="0" value="${esc(c ? c.annual_fee_swipe : '')}" placeholder="如 6"></div>
      <div class="field" id="feePointsWrap" style="display:${ft === 'points' ? 'block' : 'none'}"><label>${t('feePoints')}</label><input id="f_feepoints" type="number" min="0" value="${esc(c ? c.annual_fee_points : '')}" placeholder="如 100000"></div>
      <div class="field"><label>${t('feeDate')}</label><input id="f_feedate" type="date" value="${esc(c ? c.annual_fee_date : '')}"></div>
      <div class="field"><label>${t('colorTag')}</label><div class="color-row"><select id="f_color">${colors}</select><span class="color-preview" id="colorPrev" style="background:${esc(c ? c.color || '#4f46e5' : '#4f46e5')}"></span><span class="muted">${t('colorPreview')}</span></div></div>
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
      pv.style.backgroundImage = imgCss(imgData);
      pv.style.backgroundSize = 'cover';
      pv.style.backgroundPosition = 'center';
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
    pv.style.backgroundImage = imgCss(v);
    pv.style.backgroundSize = 'cover';
    pv.style.backgroundPosition = 'center';
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
  // 年费类型切换：显示对应输入框
  const feeTypeSel = document.getElementById('f_feetype');
  if (feeTypeSel) feeTypeSel.onchange = () => {
    const v = feeTypeSel.value;
    document.getElementById('feeAmountWrap').style.display = v === 'amount' ? 'block' : 'none';
    document.getElementById('feeSwipeWrap').style.display = v === 'swipe' ? 'block' : 'none';
    document.getElementById('feePointsWrap').style.display = v === 'points' ? 'block' : 'none';
  };
  // 颜色实时预览
  const colorSel = document.getElementById('f_color');
  const colorPrev = document.getElementById('colorPrev');
  if (colorSel && colorPrev) colorSel.onchange = () => { colorPrev.style.background = colorSel.value; };
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
      points: document.getElementById('f_points').value || null,
      annual_fee_type: document.getElementById('f_feetype').value,
      annual_fee: document.getElementById('f_fee').value || null,
      annual_fee_swipe: document.getElementById('f_feeswipe').value || null,
      annual_fee_points: document.getElementById('f_feepoints').value || null,
      annual_fee_date: document.getElementById('f_feedate').value || '',
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

/* ------------------------------- 弹窗：CSV 导入账单 ------------------------------- */
function openCsvModal() {
  const html = `<div class="modal-mask" id="mask">
    <div class="modal" style="width:min(660px,94vw)">
      <h3>导入 CSV 账单</h3>
      <div class="desc" style="margin-bottom:12px">
        按模板批量导入账单。表头需包含：<b>卡片, 账单月份, 本期账单</b>（其余可选：已还, 状态, 还款日, 备注）。<br>
        系统按「卡片」名称匹配已有信用卡；若找不到则自动新建一张同名卡片。
      </div>
      <div class="file-row" style="margin-bottom:12px">
        <input id="csvFile" type="file" accept=".csv,text/csv" style="flex:1">
        <button class="btn sm" id="csvTpl" type="button">下载模板</button>
      </div>
      <div id="csvPreview" class="csv-preview"></div>
      <div class="modal-actions">
        <button class="btn" id="csvCancel">取消</button>
        <button class="btn primary" id="csvImport" disabled>确认导入</button>
      </div>
    </div>
  </div>`;
  document.getElementById('modalRoot').innerHTML = html;
  const close = () => document.getElementById('modalRoot').innerHTML = '';
  document.getElementById('csvCancel').onclick = close;
  document.getElementById('mask').onclick = e => { if (e.target.id === 'mask') close(); };

  document.getElementById('csvTpl').onclick = () => {
    const tpl = '卡片,账单月份,本期账单,已还,状态,还款日,备注\n招行经典白,2026-09,5234.10,0,未还,2026-10-12,餐饮\n';
    const blob = new Blob(['﻿' + tpl], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ccms-bills-template.csv'; a.click();
    URL.revokeObjectURL(a.href);
  };

  let parsed = null;
  const previewEl = document.getElementById('csvPreview');
  const importBtn = document.getElementById('csvImport');

  function analyze(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { previewEl.innerHTML = '<div class="desc">没有可导入的数据行。</div>'; importBtn.disabled = true; return; }
    const header = rows[0].map(h => h.trim());
    const idx = (...names) => header.findIndex(h => names.includes(h.toLowerCase()));
    const iCard = idx('卡片', '卡名称', 'card', 'cardname');
    const iPeriod = idx('账单月份', 'period', 'month', '月份');
    const iStmt = idx('本期账单', 'statement', 'amount', '金额');
    const iPaid = idx('已还', 'paid');
    const iStatus = idx('状态', 'status');
    const iDue = idx('还款日', 'duedate', 'due');
    const iNote = idx('备注', 'note');
    if (iCard < 0 || iPeriod < 0 || iStmt < 0) {
      previewEl.innerHTML = '<div class="desc" style="color:var(--red)">模板缺少必要列：需要「卡片」「账单月份」「本期账单」。</div>';
      importBtn.disabled = true; return;
    }
    const nameMap = {};
    cards.forEach(c => { nameMap[c.name.trim().toLowerCase()] = c; });
    const statusMap = { '未还': 'unpaid', '已还': 'paid', '最低还款': 'min', 'unpaid': 'unpaid', 'paid': 'paid', 'min': 'min' };
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const cardName = (row[iCard] || '').trim();
      const period = (row[iPeriod] || '').trim();
      const stmtRaw = (row[iStmt] || '').trim();
      const paidRaw = iPaid >= 0 ? (row[iPaid] || '').trim() : '';
      const statusRaw = iStatus >= 0 ? (row[iStatus] || '').trim() : '';
      const dueRaw = iDue >= 0 ? (row[iDue] || '').trim() : '';
      const noteRaw = iNote >= 0 ? (row[iNote] || '').trim() : '';
      const warn = [];
      if (!cardName) warn.push('缺卡片');
      if (!/^\d{4}-\d{2}$/.test(period)) warn.push('月份格式应为 YYYY-MM');
      const statement = Number(stmtRaw);
      if (stmtRaw === '' || isNaN(statement)) warn.push('金额非数字');
      const paid = paidRaw === '' ? 0 : Number(paidRaw);
      const status = statusMap[statusRaw] || 'unpaid';
      const match = cardName ? (nameMap[cardName.toLowerCase()] || 'NEW') : null;
      out.push({ cardName, period, statement: isNaN(statement) ? 0 : statement, paid: isNaN(paid) ? 0 : paid, status, dueDate: dueRaw, note: noteRaw, match, warn });
    }
    parsed = out;
    renderPreview(out);
  }

  function renderPreview(list) {
    const okCount = list.filter(x => x.warn.length === 0).length;
    const newCards = [...new Set(list.filter(x => x.match === 'NEW' && x.cardName).map(x => x.cardName))];
    let h = `<div class="desc" style="margin-bottom:8px">共 ${list.length} 行，可导入 ${okCount} 行` +
      (newCards.length ? `，将自动新建卡片：${newCards.map(esc).join('、')}` : '') + `</div>`;
    h += `<table><thead><tr><th>卡片</th><th>匹配</th><th>账单月份</th><th>本期账单</th><th>已还</th><th>状态</th><th>还款日</th><th>备注</th><th>提示</th></tr></thead><tbody>`;
    h += list.map(x => `<tr>
      <td>${esc(x.cardName)}</td>
      <td>${x.match === 'NEW' ? '<span class="badge closed">新建</span>' : (x.match ? '<span class="badge paid">匹配</span>' : '<span class="badge unpaid">无</span>')}</td>
      <td>${esc(x.period)}</td><td>${x.statement}</td><td>${x.paid}</td>
      <td>${statusText(x.status)}</td><td>${esc(x.dueDate)}</td><td>${esc(x.note)}</td>
      <td class="muted">${esc(x.warn.join('，'))}</td>
    </tr>`).join('');
    h += `</tbody></table>`;
    previewEl.innerHTML = h;
    importBtn.disabled = list.length === 0;
  }

  function doImport() {
    if (!parsed) return;
    const nameMap = {};
    cards.forEach(c => { nameMap[c.name.trim().toLowerCase()] = c; });
    let added = 0, createdCards = 0, skipped = 0;
    for (const x of parsed) {
      if (x.warn.length) { skipped++; continue; }
      let card = (x.match && x.match !== 'NEW') ? x.match : nameMap[x.cardName.toLowerCase()];
      if (!card) {
        card = { id: uid(), name: x.cardName, bank: '', last4: '', billingDay: 1, dueDay: 25, gracePeriod: 50, limit: 0, color: PALETTE[cards.length % PALETTE.length], image: '', closed: false, closedAt: '', points: null, annual_fee: null, annual_fee_date: '', annual_fee_type: 'amount', annual_fee_swipe: null, annual_fee_points: null, updatedAt: Date.now() };
        cards.push(card); nameMap[x.cardName.toLowerCase()] = card; createdCards++;
      }
      bills.push({ id: uid(), cardId: card.id, period: x.period, statement: x.statement, paid: x.paid, status: x.status, dueDate: x.dueDate, note: x.note, updatedAt: Date.now() });
      added++;
    }
    close();
    commit();
    alert(`导入完成：新增 ${added} 笔账单${createdCards ? '，新建 ' + createdCards + ' 张信用卡' : ''}${skipped ? '；跳过 ' + skipped + ' 行（数据不完整）' : ''}。`);
  }

  importBtn.onclick = doImport;
  document.getElementById('csvFile').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => analyze(String(reader.result));
    reader.readAsText(f);
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
