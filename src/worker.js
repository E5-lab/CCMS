/**
 * CCMS Cloudflare Worker 入口
 * -------------------------------------------------------------
 * - 静态资源（public/）边缘托管 + SPA 单页回退
 * - /api/state  : GET  拉取当前同步密钥名下的全部数据
 * - /api/sync   : POST 增量同步（按 updatedAt 最后写入优先，支持删除传播）
 * - 数据安全：以请求头 x-ccms-token 作为 owner 命名空间隔离，多设备使用同一密钥即可同步。
 *   生产环境建议替换为正式鉴权（JWT / 用户系统）。
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

// 从 D1 读出的行做规范化：closed 转布尔
function norm(rows) {
  if (!rows) return [];
  return rows.map((r) => (r.closed !== undefined ? { ...r, closed: !!r.closed } : r));
}

async function handleApi(request, env, url) {
  const owner = request.headers.get('x-ccms-token') || 'default';
  const db = env.DB;
  const p = url.pathname;

  // D1 未绑定（尚未在 Cloudflare 后台手动添加绑定）时给出明确提示
  if (!db) {
    return json(
      {
        error: 'D1_NOT_CONFIGURED',
        message: '云端存储未启用：请在 Cloudflare 后台为该 Worker 绑定 D1 数据库（变量名 DB），并在数据库 Console 中执行 migrations/0001_init.sql 建表。',
      },
      503
    );
  }

  if (p === '/api/state' && request.method === 'GET') {
    const c = await db.prepare('SELECT * FROM cards WHERE owner=?').bind(owner).all();
    const b = await db.prepare('SELECT * FROM bills WHERE owner=?').bind(owner).all();
    return json({ cards: norm(c.results), bills: norm(b.results) });
  }

  if (p === '/api/sync' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }
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
