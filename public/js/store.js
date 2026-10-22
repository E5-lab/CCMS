/* =========================================================================
 * CCMS · 数据层（协调本地 / 云端 / WebDAV + 增量同步 + 离线写队列）
 * - 本地永远先写缓存（离线可用）
 * - 云端模式：拉取用 since 游标增量；上传后应用服务端返回的全量增量（LWW + 墓碑）
 * - WebDAV 模式：整本账本读写一个 JSON 文件，本地与远端按 updatedAt 做记录级合并，
 *   并用「删除墓碑」保证 A 设备删掉的记录不会被 B 设备同步回来
 * - 网络恢复时自动回放离线期间的本地改动
 * ========================================================================= */

// 记录级 LWW 合并：远端更新时间更新则覆盖本地
function mergeLWW(localList, remoteList) {
  const map = new Map(localList.map(x => [x.id, x]));
  for (const r of remoteList) {
    const l = map.get(r.id);
    if (!l || (Number(r.updatedAt) || 0) >= (Number(l.updatedAt) || 0)) map.set(r.id, r);
  }
  return [...map.values()];
}

/* ---------------- WebDAV 删除墓碑：记录「何时删了哪条」 ---------------- */
// 没有墓碑时，A 设备删除记录后，B 设备下一次同步会把这条旧记录原样推回来。
function loadTomb() {
  const t = load(LS.tomb, null);
  if (!t || typeof t !== 'object') return { cards: {}, bills: {} };
  return { cards: t.cards && typeof t.cards === 'object' ? t.cards : {}, bills: t.bills && typeof t.bills === 'object' ? t.bills : {} };
}
function saveTomb(t) { try { localStorage.setItem(LS.tomb, JSON.stringify(t)); } catch (e) { /* 隐私模式忽略 */ } }
function pruneTomb(t) {
  const cut = Date.now() - 180 * 864e5; // 半年前的墓碑不再需要，避免无限增长
  for (const k of ['cards', 'bills']) {
    for (const id in t[k]) if ((Number(t[k][id]) || 0) < cut) delete t[k][id];
  }
  return t;
}
function markTomb(t, kind, ids) {
  const now = Date.now();
  (ids || []).filter(Boolean).forEach(id => { t[kind][id] = Math.max(Number(t[kind][id]) || 0, now); });
}

// 本地 + 远端记录合并：updatedAt 大者胜；墓碑时间 >= 记录时间 的视为已删除
function mergeWithTomb(localList, remoteList, tombMap) {
  const ts = r => Number(r && r.updatedAt) || 0;
  const map = new Map();
  (localList || []).forEach(x => { if (x && x.id) map.set(x.id, x); });
  (remoteList || []).forEach(r => {
    if (!r || !r.id) return;
    const l = map.get(r.id);
    if (!l || ts(r) > ts(l)) map.set(r.id, { ...r, updatedAt: ts(r) || Date.now() });
  });
  for (const id in (tombMap || {})) {
    const rec = map.get(id);
    if (rec && (Number(tombMap[id]) || 0) >= ts(rec)) map.delete(id);
  }
  return [...map.values()];
}

// 内容指纹：只比较 id + updatedAt + 墓碑，用于判断「合并后是否真的需要回写」
function stateSig(c, b, t) {
  const list = l => (l || []).filter(x => x && x.id).map(x => String(x.id) + ':' + (Number(x.updatedAt) || 0)).sort().join('|');
  const tomb = m => Object.keys(m || {}).sort().map(k => k + ':' + m[k]).join('|');
  return [list(c), list(b), tomb((t || {}).cards), tomb((t || {}).bills)].join('#');
}

const Store = {
  mode: localStorage.getItem(LS.mode) || 'local',     // 'local' | 'cloud' | 'webdav'
  email: localStorage.getItem(LS.email) || '',
  session: localStorage.getItem(LS.session) || '',
  cursor: Number(localStorage.getItem(LS.cursor)) || 0, // 上次同步游标
  dirty: false,                                        // 离线写队列标记
  pendingDelete: { cards: [], bills: [] },
  _busy: false,                                        // WebDAV 同步重入锁

  get isCloud() { return this.mode === 'cloud' && !!this.session; },
  get isWebdav() { return this.mode === 'webdav' && typeof WebDAV !== 'undefined' && WebDAV.configured; },

  _cache(c, b) { localStorage.setItem(LS.cards, JSON.stringify(c)); localStorage.setItem(LS.bills, JSON.stringify(b)); },

  // 应用服务端增量：LWW 合并 + 墓碑删除
  _apply(delta) {
    // 归一化：无论服务端返回 updatedAt 还是 updated_at，都统一为 updatedAt，保证 LWW 比较正确
    const norm = r => ({ ...r, updatedAt: Number(r.updatedAt) || Number(r.updated_at) || Date.now() });
    cards = mergeLWW(cards, (delta.cards || []).map(c => norm({ ...c, closed: !!c.closed })));
    bills = mergeLWW(bills, (delta.bills || []).map(norm));
    (delta.tombCards || []).forEach(id => { cards = cards.filter(x => x.id !== id); this.pendingDelete.cards = this.pendingDelete.cards.filter(x => x !== id); });
    (delta.tombBills || []).forEach(id => { bills = bills.filter(x => x.id !== id); this.pendingDelete.bills = this.pendingDelete.bills.filter(x => x !== id); });
    if (delta.cursor) { this.cursor = delta.cursor; localStorage.setItem(LS.cursor, String(this.cursor)); }
    this._cache(cards, bills);
  },

  // WebDAV：拉取 → 三方（本地/远端/墓碑）合并 → 需要时回写 → 落地缓存
  async _webdavSync() {
    if (this._busy) return { cards, bills };   // 并发调用（如聚焦与保存撞车）直接返回当前数据
    this._busy = true;
    try {
      const remote = await WebDAV.load();
      const tomb = pruneTomb(loadTomb());
      // 本机待同步的删除动作先落进墓碑，再参与合并
      markTomb(tomb, 'cards', this.pendingDelete.cards);
      markTomb(tomb, 'bills', this.pendingDelete.bills);
      // 吸收远端墓碑（取较新的删除时间）
      const rt = (remote && remote.tomb) || {};
      for (const k of ['cards', 'bills']) {
        for (const id in (rt[k] || {})) tomb[k][id] = Math.max(Number(tomb[k][id]) || 0, Number(rt[k][id]) || 0);
      }
      cards = mergeWithTomb(cards, remote && remote.cards, tomb.cards);
      bills = mergeWithTomb(bills, remote && remote.bills, tomb.bills);
      saveTomb(tomb);
      this.pendingDelete = { cards: [], bills: [] };

      const payload = { app: 'ccms', version: 2, updatedAt: Date.now(), cards, bills, tomb };
      const changed = !remote || stateSig(remote.cards, remote.bills, remote.tomb) !== stateSig(cards, bills, tomb);
      if (changed) await WebDAV.save(payload);

      this._cache(cards, bills);
      this.dirty = false;
      return { cards, bills };
    } finally {
      this._busy = false;
    }
  },

  async load() {
    // 先用本地缓存打底（刷新后立即有数据），再合并远端增量——
    // 若反过来（先合并再读缓存），空增量会把空结果写回缓存，导致“刷新后卡片消失”。
    if (!cards.length && !bills.length) { cards = load(LS.cards, []); bills = load(LS.bills, []); }
    if (this.isWebdav) {
      // 本地优先：远端不可达时用本地缓存继续用，写入失败会由 save() 单独提示
      try { await this._webdavSync(); }
      catch (e) { console.warn('[CCMS] WebDAV 同步失败，已回退本地数据：', e.message); }
    } else if (this.isCloud) {
      try { this._apply(await Sync.load(this.session, this.cursor || 0)); }
      catch (e) { if (navigator.onLine) throw e; } // 离线则使用本地缓存
    }
    return { cards, bills };
  },

  async save(c, b) {
    cards = c; bills = b; this._cache(cards, bills);   // 始终先写本地缓存（离线写队列）
    if (this.isWebdav) {
      try { return await this._webdavSync(); }
      catch (e) {
        if (navigator.onLine) throw e;   // 在线但出错才提示
        this.dirty = true;               // 离线：标记脏，待 online 时回放
        return { cards, bills };
      }
    }
    if (!this.isCloud) return { cards, bills };
    try {
      const d = await Sync.save(this.session, { cards, bills, deleteCards: this.pendingDelete.cards, deleteBills: this.pendingDelete.bills }, this.cursor || 0);
      this.pendingDelete = { cards: [], bills: [] };
      this._apply(d); this.dirty = false;
      return { cards, bills };
    } catch (e) {
      if (navigator.onLine) throw e;   // 在线但出错才提示
      this.dirty = true;              // 离线：标记脏，待 online 时回放
      return { cards, bills };
    }
  },
};

// 离线写队列回放：网络恢复时把本地改动推送到远端
async function flushQueue() {
  if ((Store.isCloud || Store.isWebdav) && Store.dirty) {
    Store.dirty = false;
    try { const s = await Store.save(cards, bills); cards = s.cards; bills = s.bills; render(); }
    catch (e) { Store.dirty = true; }
  }
}
window.addEventListener('online', flushQueue);
