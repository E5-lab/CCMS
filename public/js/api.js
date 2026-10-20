/* =========================================================================
 * CCMS · 接口层（鉴权 + 增量同步，纯 fetch 封装）
 * 所有请求失败都通过 apiError 返回友好提示（含 D1 未配置等情况）。
 * ========================================================================= */

// 读取 API 错误响应中的友好提示（如 D1 未绑定）
async function apiError(r, fallback) {
  try {
    const d = await r.json();
    if (d && d.message) return d.message;
    if (d && d.error) return fallback + '：' + d.error;
  } catch (e) { /* ignore */ }
  return fallback + ' (' + r.status + ')';
}

/* ----------------------------- 鉴权层（Auth） ----------------------------- */
const Auth = {
  async register(email, password) {
    const r = await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error(await apiError(r, '注册失败'));
    return r.json();
  },
  async login(email, password) {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error(await apiError(r, '登录失败'));
    return r.json();
  },
  async logout(session) {
    if (session) { try { await fetch('/api/logout', { method: 'POST', headers: { 'authorization': 'Bearer ' + session } }); } catch (e) {} }
  },
  // 保存昵称到云端账户（需在 Worker 提供 PUT /api/me 支持；本地存储始终生效）
  async saveNick(nickname) {
    const r = await fetch('/api/me', { method: 'PUT', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + Store.session }, body: JSON.stringify({ nickname }) });
    if (!r.ok) throw new Error(await apiError(r, '云端保存昵称失败'));
    return r.json();
  },
};

/* ----------------------------- 同步层（Sync：增量 + 墓碑 + LWW） ----------------------------- */
const Sync = {
  async load(session, since) {
    const url = '/api/state' + (since ? ('?since=' + since) : '');
    const r = await fetch(url, { headers: { 'authorization': 'Bearer ' + session } });
    if (!r.ok) throw new Error(await apiError(r, '同步拉取失败'));
    return r.json();
  },
  async save(session, data, since) {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + session }, body: JSON.stringify({ ...data, since }) });
    if (!r.ok) throw new Error(await apiError(r, '同步失败'));
    return r.json();
  },
};
