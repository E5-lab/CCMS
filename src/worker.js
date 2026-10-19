/**
 * CCMS Cloudflare Worker 入口
 * -------------------------------------------------------------
 * 静态资源（public/）边缘托管 + SPA 单页回退
 *
 * 认证（邮箱+密码，PBKDF2 加盐哈希；会话存 D1）：
 *   POST /api/register  注册 -> { token, email }
 *   POST /api/login     登录 -> { token, email }
 *   POST /api/logout    注销当前会话
 *   GET  /api/me        返回当前登录邮箱
 *
 * 数据接口（需鉴权，记录级同步）：
 *   GET  /api/state?since=TS   增量/全量拉取（含墓碑）
 *   POST /api/sync             增量上传（LWW 合并 + 墓碑删除）
 *
 * 推送订阅（需鉴权）：
 *   POST /api/push/subscribe   保存 Web Push 订阅
 *   POST /api/push/unsubscribe 删除订阅
 *
 * 定时任务（Cron）：主动还款提醒，通过 Web Push 推送临近还款的账单。
 *   需配置环境变量 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY（base64url）。
 */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function num(v, dflt) {
  const n = Number(v);
  if (v === undefined || v === null || !Number.isFinite(n)) return dflt !== undefined ? dflt : null;
  return n;
}
function norm(rows) {
  if (!rows) return [];
  return rows.map((r) => (r.closed !== undefined ? { ...r, closed: !!r.closed, deleted: !!r.deleted } : r));
}

const enc = new TextEncoder();

async function derive(password, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return new Uint8Array(Buffer.from(s, 'base64'));
}

async function getSessionUser(db, token) {
  if (!token) return null;
  const s = await db.prepare('SELECT user_id, expires_at FROM sessions WHERE token=?').bind(token).first();
  if (!s) return null;
  if (s.expires_at < Date.now()) { await db.prepare('DELETE FROM sessions WHERE token=?').bind(token).run(); return null; }
  const u = await db.prepare('SELECT id, email FROM users WHERE id=?').bind(s.user_id).first();
  return u || null;
}
async function createSession(db, userId) {
  const token = randomHex(32);
  await db.prepare('INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .bind(token, userId, Date.now() + 30 * 24 * 3600 * 1000).run();
  return token;
}
async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}
async function requireUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.DB) return { error: json({ error: 'D1_NOT_CONFIGURED', message: '云端存储未启用：请在 Cloudflare 后台为该 Worker 绑定 D1 数据库（变量名 DB），并在数据库 Console 依次执行 migrations 下的 0001/0002/0003 SQL 建表。' }, 503) };
  const u = await getSessionUser(env.DB, token);
  if (!u) return { error: json({ error: 'UNAUTHORIZED', message: '未登录或会话已过期，请重新登录。' }, 401) };
  return { user: u };
}

/* ------------------------------- 同步逻辑（增量 + 墓碑 + LWW） ------------------------------- */
async function getDelta(db, owner, since) {
  const cursor = Date.now();
  if (!since) {
    const c = await db.prepare('SELECT * FROM cards WHERE owner=? AND deleted=0').bind(owner).all();
    const b = await db.prepare('SELECT * FROM bills WHERE owner=? AND deleted=0').bind(owner).all();
    return { cards: norm(c.results), bills: norm(b.results), tombCards: [], tombBills: [], cursor };
  }
  const c = await db.prepare('SELECT * FROM cards WHERE owner=? AND updated_at > ?').bind(owner, since).all();
  const b = await db.prepare('SELECT * FROM bills WHERE owner=? AND updated_at > ?').bind(owner, since).all();
  const tc = await db.prepare('SELECT id FROM cards WHERE owner=? AND deleted=1 AND updated_at > ?').bind(owner, since).all();
  const tb = await db.prepare('SELECT id FROM bills WHERE owner=? AND deleted=1 AND updated_at > ?').bind(owner, since).all();
  return {
    cards: norm(c.results), bills: norm(b.results),
    tombCards: (tc.results || []).map(r => r.id), tombBills: (tb.results || []).map(r => r.id), cursor,
  };
}

// LWW：仅当传入记录更新时间 >= 现有才覆盖；删除转为墓碑（deleted=1）
async function applyUpserts(db, owner, kind, rows, now) {
  for (const r of rows) {
    const existing = await db.prepare(`SELECT updated_at FROM ${kind} WHERE id=? AND owner=?`).bind(r.id, owner).first();
    const ru = Number(r.updatedAt) || 0;
    if (existing && Number(existing.updated_at) > ru) continue; // 服务端更新则跳过
    if (kind === 'cards') {
      await db.prepare(`INSERT OR REPLACE INTO cards
        (id, owner, name, bank, last4, billingDay, dueDay, gracePeriod, \`limit\`, color, image, closed, closedAt, points, annual_fee, annual_fee_date, deleted, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
        .bind(r.id, owner, r.name, r.bank ?? null, r.last4 ?? null, num(r.billingDay), num(r.dueDay), num(r.gracePeriod), num(r.limit),
          r.color ?? null, r.image ?? null, r.closed ? 1 : 0, r.closedAt ?? null, num(r.points), num(r.annual_fee), r.annual_fee_date ?? null, ru || now).run();
    } else {
      await db.prepare(`INSERT OR REPLACE INTO bills
        (id, owner, cardId, period, statement, paid, status, dueDate, note, deleted, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,0,?)`)
        .bind(r.id, owner, r.cardId, r.period, num(r.statement), num(r.paid), r.status, r.dueDate ?? null, r.note ?? null, ru || now).run();
    }
  }
}
async function applyDeletes(db, owner, table, ids, now) {
  for (const id of ids) {
    await db.prepare(`UPDATE ${table} SET deleted=1, updated_at=? WHERE id=? AND owner=?`).bind(now, id, owner).run();
  }
}

/* ------------------------------- Web Push（RFC 8291 / 8188） ------------------------------- */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}
async function sendWebPush(subscription, payload, vapidPub, vapidPriv, subject) {
  const uaPub = await crypto.subtle.importKey('raw', b64urlDecode(subscription.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const authSecret = b64urlDecode(subscription.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const z = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPub }, eph.privateKey, 256));

  const context = new Uint8Array([0, ...b64urlDecode(subscription.p256dh), ...ephPubRaw]);
  const info1 = new Uint8Array([...enc.encode('WebPush: info'), 0, ...context]);
  const prk = await hkdf(authSecret, z, new Uint8Array(0), 32);
  const ikm = await hkdf(prk, new Uint8Array(0), info1, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk2 = await hkdf(salt, ikm, new Uint8Array(0), 32);
  const cek = await hkdf(prk2, new Uint8Array(0), new Uint8Array([...enc.encode('Content-Encoding: aes128gcm'), 0, ...context]), 16);
  const nonce = await hkdf(prk2, new Uint8Array(0), new Uint8Array([...enc.encode('Content-Encoding: nonce'), 0, ...context]), 12);

  const plain = new Uint8Array([0, 0, ...enc.encode(payload)]); // pad length 0
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plain));

  const body = new Uint8Array([...salt, 0, 0, 0x10, 0, ...ct]); // rs = 4096, idlen = 0

  // VAPID JWT（ES256）
  const vpriv = await crypto.subtle.importKey('raw', b64urlDecode(vapidPriv), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const aud = new URL(subscription.endpoint).origin;
  const claim = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vpriv, enc.encode(header + '.' + claim)));
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const vapid = `vapid t=${jwt}, k=${vapidPub}`;

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', Encryption: `salt=${b64url(salt)}`, 'Crypto-Key': `p256ecdsa=${b64url(ephPubRaw)}`, Authorization: vapid, TTL: '86400' },
    body,
  });
  return res.status;
}

async function sendReminders(env) {
  if (!env.DB) return;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('VAPID 未配置，跳过 Web Push 提醒。');
    return;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = today.getTime() + 3 * 24 * 3600 * 1000;
  const due = await env.DB.prepare(
    `SELECT b.id, b.cardId, b.period, b.statement, b.paid, b.status, b.dueDate, b.owner
     FROM bills b WHERE b.deleted=0 AND b.status<>'paid' AND b.dueDate IS NOT NULL`
  ).all();
  const rows = (due.results || []).filter(r => {
    const t = Date.parse(r.dueDate + 'T00:00:00'); return t >= today.getTime() && t <= horizon;
  });
  const byUser = {};
  for (const r of rows) (byUser[r.owner] = byUser[r.owner] || []).push(r);
  for (const owner of Object.keys(byUser)) {
    const subs = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').bind(owner).all();
    for (const s of (subs.results || [])) {
      const remaining = byUser[owner].reduce((sum, r) => sum + (Number(r.statement) - Number(r.paid || 0)), 0);
      const soon = byUser[owner].slice().sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))[0];
      const msg = `你有 ${byUser[owner].length} 笔账单临近还款，最早 ${soon.dueDate} 到期，待还 ¥${remaining.toFixed(2)}`;
      try {
        await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, JSON.stringify({ title: 'CCMS 还款提醒', body: msg }), env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, 'mailto:ccms@example.com');
      } catch (e) { console.error('push failed', e.message); }
    }
  }
}

/* ------------------------------- 路由 ------------------------------- */
async function handleApi(request, env, url) {
  const p = url.pathname;
  const db = env.DB;

  if (p === '/api/register' && request.method === 'POST') {
    if (!db) return json({ error: 'D1_NOT_CONFIGURED', message: '云端存储未启用：请先在 Cloudflare 后台绑定 D1 并建表。' }, 503);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
    if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);
    if (await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) return json({ error: '该邮箱已注册，请直接登录' }, 409);
    const salt = randomHex(16); const pass_hash = await derive(password, salt);
    const id = randomHex(16);
    await db.prepare('INSERT INTO users (id, email, pass_hash, salt, created_at) VALUES (?,?,?,?,?)').bind(id, email, pass_hash, salt, Date.now()).run();
    return json({ token: await createSession(db, id), email });
  }
  if (p === '/api/login' && request.method === 'POST') {
    if (!db) return json({ error: 'D1_NOT_CONFIGURED', message: '云端存储未启用：请先在 Cloudflare 后台绑定 D1 并建表。' }, 503);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const u = await db.prepare('SELECT id, email, pass_hash, salt FROM users WHERE email=?').bind(email).first();
    if (!u) return json({ error: '账号或密码错误' }, 401);
    if ((await derive(password, u.salt)) !== u.pass_hash) return json({ error: '账号或密码错误' }, 401);
    return json({ token: await createSession(db, u.id), email: u.email });
  }
  if (p === '/api/logout' && request.method === 'POST') {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (db && token) await db.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
    return json({ ok: true });
  }
  if (p === '/api/me' && request.method === 'GET') {
    const r = await requireUser(request, env); if (r.error) return r.error;
    return json({ email: r.user.email });
  }

  if (p === '/api/push/subscribe' && request.method === 'POST') {
    const r = await requireUser(request, env); if (r.error) return r.error;
    const b = await readBody(request);
    if (!b.endpoint || !b.p256dh || !b.auth) return json({ error: '缺少订阅参数' }, 400);
    const now = Date.now();
    await db.prepare('INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(randomHex(16), r.user.id, b.endpoint, b.p256dh, b.auth, now, now).run();
    return json({ ok: true });
  }
  if (p === '/api/push/unsubscribe' && request.method === 'POST') {
    const r = await requireUser(request, env); if (r.error) return r.error;
    const b = await readBody(request);
    if (b.endpoint) await db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').bind(r.user.id, b.endpoint).run();
    return json({ ok: true });
  }

  if (p === '/api/state' && request.method === 'GET') {
    const r = await requireUser(request, env); if (r.error) return r.error;
    const since = Number(url.searchParams.get('since')) || 0;
    return json(await getDelta(db, r.user.id, since));
  }
  if (p === '/api/sync' && request.method === 'POST') {
    const r = await requireUser(request, env); if (r.error) return r.error;
    const body = await readBody(request);
    const now = Date.now();
    const since = Number(body.since) || 0;
    await applyUpserts(db, r.user.id, 'cards', Array.isArray(body.cards) ? body.cards : [], now);
    await applyUpserts(db, r.user.id, 'bills', Array.isArray(body.bills) ? body.bills : [], now);
    await applyDeletes(db, r.user.id, 'cards', Array.isArray(body.deleteCards) ? body.deleteCards : [], now);
    await applyDeletes(db, r.user.id, 'bills', Array.isArray(body.deleteBills) ? body.deleteBills : [], now);
    return json(await getDelta(db, r.user.id, 0));
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); }
      catch (e) { return json({ error: String(e && e.message ? e.message : e) }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    try { await sendReminders(env); } catch (e) { console.error('scheduled error', e.message); }
  },
};
