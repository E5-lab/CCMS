/**
 * CCMS Cloudflare Worker 入口
 * -------------------------------------------------------------
 * - 静态资源（public/）边缘托管 + SPA 单页回退
 * - 认证（替代同步密钥）：邮箱 + 密码，PBKDF2 加盐哈希；会话存 D1
 *   POST /api/register  注册 -> { token, email }
 *   POST /api/login     登录 -> { token, email }
 *   POST /api/logout    注销当前会话
 *   GET  /api/me        返回当前登录邮箱
 * - 数据接口（需鉴权）：
 *   GET  /api/state     拉取当前用户全部数据
 *   POST /api/sync      增量同步（按 updatedAt 最后写入优先，支持删除传播）
 * - 数据安全：以 user_id 做数据隔离，密码仅存哈希，不落明文。
 */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function num(v, dflt) {
  const n = Number(v);
  if (v === undefined || v === null || !Number.isFinite(n)) return dflt !== undefined ? dflt : null;
  return n;
}

function norm(rows) {
  if (!rows) return [];
  return rows.map((r) => (r.closed !== undefined ? { ...r, closed: !!r.closed } : r));
}

const enc = new TextEncoder();

// PBKDF2 派生：password + salt -> 256bit 哈希(hex)
async function derive(password, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSessionUser(db, token) {
  if (!token) return null;
  const s = await db.prepare('SELECT user_id, expires_at FROM sessions WHERE token=?').bind(token).first();
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
    return null;
  }
  const u = await db.prepare('SELECT id, email FROM users WHERE id=?').bind(s.user_id).first();
  return u || null;
}

async function createSession(db, userId) {
  const token = randomHex(32);
  const expires = Date.now() + 30 * 24 * 3600 * 1000; // 30 天
  await db.prepare('INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .bind(token, userId, expires).run();
  return token;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function requireUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.DB) return { error: json({ error: 'D1_NOT_CONFIGURED', message: '云端存储未启用：请在 Cloudflare 后台为该 Worker 绑定 D1 数据库（变量名 DB），并在数据库 Console 中执行 migrations 下的 SQL 建表。' }, 503) };
  const u = await getSessionUser(env.DB, token);
  if (!u) return { error: json({ error: 'UNAUTHORIZED', message: '未登录或会话已过期，请重新登录。' }, 401) };
  return { user: u };
}

async function handleApi(request, env, url) {
  const p = url.pathname;
  const db = env.DB;

  // ---- 认证接口 ----
  if (p === '/api/register' && request.method === 'POST') {
    if (!db) return json({ error: 'D1_NOT_CONFIGURED', message: '云端存储未启用：请先在 Cloudflare 后台绑定 D1 并建表。' }, 503);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
    if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);
    const exist = await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
    if (exist) return json({ error: '该邮箱已注册，请直接登录' }, 409);
    const salt = randomHex(16);
    const pass_hash = await derive(password, salt);
    const id = randomHex(16);
    await db.prepare('INSERT INTO users (id, email, pass_hash, salt, created_at) VALUES (?,?,?,?,?)')
      .bind(id, email, pass_hash, salt, Date.now()).run();
    const token = await createSession(db, id);
    return json({ token, email });
  }

  if (p === '/api/login' && request.method === 'POST') {
    if (!db) return json({ error: 'D1_NOT_CONFIGURED', message: '云端存储未启用：请先在 Cloudflare 后台绑定 D1 并建表。' }, 503);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const u = await db.prepare('SELECT id, email, pass_hash, salt FROM users WHERE email=?').bind(email).first();
    if (!u) return json({ error: '账号或密码错误' }, 401);
    const hash = await derive(password, u.salt);
    if (hash !== u.pass_hash) return json({ error: '账号或密码错误' }, 401);
    const token = await createSession(db, u.id);
    return json({ token, email: u.email });
  }

  if (p === '/api/logout' && request.method === 'POST') {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (db && token) await db.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
    return json({ ok: true });
  }

  if (p === '/api/me' && request.method === 'GET') {
    const r = await requireUser(request, env);
    if (r.error) return r.error;
    return json({ email: r.user.email });
  }

  // ---- 数据接口（需鉴权）----
  if (p === '/api/state' && request.method === 'GET') {
    const r = await requireUser(request, env);
    if (r.error) return r.error;
    const owner = r.user.id;
    const c = await db.prepare('SELECT * FROM cards WHERE owner=?').bind(owner).all();
    const b = await db.prepare('SELECT * FROM bills WHERE owner=?').bind(owner).all();
    return json({ cards: norm(c.results), bills: norm(b.results) });
  }

  if (p === '/api/sync' && request.method === 'POST') {
    const r = await requireUser(request, env);
    if (r.error) return r.error;
    const owner = r.user.id;
    const body = await readBody(request);
    const cards = Array.isArray(body.cards) ? body.cards : [];
    const bills = Array.isArray(body.bills) ? body.bills : [];
    const delC = Array.isArray(body.deleteCards) ? body.deleteCards : [];
    const delB = Array.isArray(body.deleteBills) ? body.deleteBills : [];
    const now = Date.now();

    const stmts = [];
    delC.forEach((id) => stmts.push(db.prepare('DELETE FROM cards WHERE id=? AND owner=?').bind(id, owner)));
    delB.forEach((id) => stmts.push(db.prepare('DELETE FROM bills WHERE id=? AND owner=?').bind(id, owner)));

    cards.forEach((c) =>
      stmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO cards
           (id, owner, name, bank, last4, billingDay, dueDay, gracePeriod, \`limit\`, color, image, closed, closedAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          c.id, owner, c.name, c.bank ?? null, c.last4 ?? null,
          num(c.billingDay), num(c.dueDay), num(c.gracePeriod), num(c.limit),
          c.color ?? null, c.image ?? null, c.closed ? 1 : 0, c.closedAt ?? null, num(c.updatedAt, now)
        )
      )
    );

    bills.forEach((b) =>
      stmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO bills
           (id, owner, cardId, period, statement, paid, status, dueDate, note, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          b.id, owner, b.cardId, b.period, num(b.statement), num(b.paid),
          b.status, b.dueDate ?? null, b.note ?? null, num(b.updatedAt, now)
        )
      )
    );

    if (stmts.length) await db.batch(stmts);

    const c2 = await db.prepare('SELECT * FROM cards WHERE owner=?').bind(owner).all();
    const b2 = await db.prepare('SELECT * FROM bills WHERE owner=?').bind(owner).all();
    return json({ cards: norm(c2.results), bills: norm(b2.results) });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return json({ error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    // 其余请求交由 Static Assets 处理（含 SPA 单页回退）
    return env.ASSETS.fetch(request);
  },
};
