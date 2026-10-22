/* =========================================================================
 * CCMS · WebDAV 客户端（自建存储 / 多设备同步）
 * 把整个账本序列化为一个 JSON 文件，通过 WebDAV 读写：
 *   GET -> 拉取远端账本（404 表示文件尚未创建，视为空账本）
 *   PUT -> 覆盖写入（父目录不存在时自动 MKCOL 建目录后重试）
 * 鉴权：HTTP Basic（用户名 + 密码），凭据只保存在本机 localStorage，不上传任何服务器。
 * 注意：浏览器直连 WebDAV 属于跨域请求，服务端必须返回 CORS 头，否则会被拦截。
 * ========================================================================= */

// UTF-8 安全的 Base64：账号或密码含中文时 btoa() 会直接抛错
function b64utf8(s) {
  const bytes = new TextEncoder().encode(String(s));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const WebDAV = {
  get url() { return (localStorage.getItem(LS.webdavUrl) || '').trim(); },
  get user() { return localStorage.getItem(LS.webdavUser) || ''; },
  get pass() { return localStorage.getItem(LS.webdavPass) || ''; },
  get configured() { return /^https?:\/\//i.test(this.url); },

  setConfig(url, user, pass) {
    localStorage.setItem(LS.webdavUrl, String(url || '').trim());
    localStorage.setItem(LS.webdavUser, String(user || ''));
    localStorage.setItem(LS.webdavPass, String(pass || ''));
  },
  clearConfig() {
    [LS.webdavUrl, LS.webdavUser, LS.webdavPass].forEach(k => localStorage.removeItem(k));
  },

  _headers(extra) {
    const h = Object.assign({}, extra || {});
    if (this.user || this.pass) h['authorization'] = 'Basic ' + b64utf8(this.user + ':' + this.pass);
    return h;
  },

  // 统一请求：把网络层异常翻译成可读提示（跨域被拦截时浏览器只会抛 TypeError: Failed to fetch）
  async _req(method, body) {
    const headers = this._headers(body != null ? { 'content-type': 'application/json;charset=utf-8' } : null);
    const opt = { method, headers, cache: 'no-store', credentials: 'omit' };
    if (body != null) opt.body = body;
    try {
      return await fetch(this.url, opt);
    } catch (e) {
      throw new Error(navigator.onLine
        ? '无法连接 WebDAV：请确认地址可访问，且服务器已开启 CORS（Access-Control-Allow-Origin / -Headers / -Methods）。'
        : '当前处于离线状态，无法访问 WebDAV。');
    }
  },

  _err(r, action) {
    if (r.status === 401 || r.status === 403) return action + '失败：认证未通过，请检查用户名/密码或该目录的读写权限。';
    if (r.status === 404) return action + '失败：路径不存在，请确认目录已创建。';
    if (r.status === 405) return action + '失败：服务器不允许该操作（需支持 WebDAV PUT）。';
    if (r.status === 409) return action + '失败：父目录不存在。';
    if (r.status === 507) return action + '失败：服务器存储空间不足。';
    return action + '失败：HTTP ' + r.status;
  },

  // 读取远端账本；文件不存在返回 null
  async load() {
    const r = await this._req('GET');
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(this._err(r, '读取'));
    const txt = (await r.text()).trim();
    if (!txt) return null;
    let d = null;
    try { d = JSON.parse(txt); } catch (e) { throw new Error('远端文件不是合法的 JSON，请确认填写的是 CCMS 数据文件。'); }
    if (!d || !Array.isArray(d.cards) || !Array.isArray(d.bills)) throw new Error('远端 JSON 不是 CCMS 账本格式（缺少 cards / bills 字段）。');
    return d;
  },

  // 写入远端账本；父目录不存在时先建目录再重试一次
  async save(payload) {
    const body = JSON.stringify(payload);
    let r = await this._req('PUT', body);
    if (r.status === 409 || r.status === 404) {
      await this._mkcolParent();
      r = await this._req('PUT', body);
    }
    if (!r.ok) throw new Error(this._err(r, '写入'));
    return true;
  },

  // 逐级创建父目录（已存在的返回 405 属正常，忽略）
  async _mkcolParent() {
    let u;
    try { u = new URL(this.url); } catch (e) { return; }
    const segs = u.pathname.split('/').filter(Boolean).slice(0, -1); // 去掉文件名本身
    let path = '';
    for (const s of segs) {
      path += '/' + s;
      try {
        await fetch(u.origin + path + '/', { method: 'MKCOL', headers: this._headers(), credentials: 'omit' });
      } catch (e) { /* 尽力而为，失败交给 PUT 的结果报错 */ }
    }
  },

  // 连接测试：能读到内容或明确 404，都说明服务器可达且鉴权通过
  async test() {
    if (!this.configured) throw new Error('请先填写以 http:// 或 https:// 开头的 WebDAV 文件地址。');
    const r = await this._req('GET');
    if (r.status === 401 || r.status === 403) throw new Error('认证未通过：请检查用户名与密码。');
    if (r.ok || r.status === 404) return true;
    throw new Error('连接失败：HTTP ' + r.status);
  },
};
