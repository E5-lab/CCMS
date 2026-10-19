/* =========================================================================
 * CCMS · 数据层（协调云端/本地 + 增量同步 + 离线写队列）
 * - 本地永远先写缓存（离线可用）
 * - 云端模式：拉取用 since 游标增量；上传后应用服务端返回的全量增量（LWW + 墓碑）
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

const Store = {
  mode: localStorage.getItem(LS.mode) || 'local',     // 'local' | 'cloud'
  email: localStorage.getItem(LS.email) || '',
  session: localStorage.getItem(LS.session) || '',
  cursor: Number(localStorage.getItem(LS.cursor)) || 0, // 上次同步游标
  dirty: false,                                        // 离线写队列标记
  pendingDelete: { cards: [], bills: [] },

  get isCloud() { return this.mode === 'cloud' && !!this.session; },

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

  async load() {
    if (this.isCloud) {
      try { this._apply(await Sync.load(this.session, this.cursor || 0)); }
      catch (e) { if (navigator.onLine) throw e; } // 离线则使用本地缓存
    }
    if (!cards.length && !bills.length) { cards = load(LS.cards, []); bills = load(LS.bills, []); }
    return { cards, bills };
  },

  async save(c, b) {
    cards = c; bills = b; this._cache(cards, bills);   // 始终先写本地缓存（离线写队列）
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

// 离线写队列回放：网络恢复时把本地改动推送到云端
async function flushQueue() {
  if (Store.isCloud && Store.dirty) {
    Store.dirty = false;
    try { const s = await Store.save(cards, bills); cards = s.cards; bills = s.bills; render(); }
    catch (e) { Store.dirty = true; }
  }
}
window.addEventListener('online', flushQueue);
