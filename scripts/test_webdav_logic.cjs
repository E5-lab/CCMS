/* 纯逻辑回归：WebDAV 模式的 LWW 合并 / 删除墓碑 / 回写判定
 * 运行：node scripts/test_webdav_logic.js
 * 用 vm 把 store.js 放到伪造的浏览器环境里执行，只测数据层语义，不启动浏览器。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'store.js'), 'utf8');
const utilSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'util.js'), 'utf8');

function makeCtx(remoteFile) {
  const store = new Map();
  const puts = [];
  const ctx = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    navigator: { onLine: true },
    console,
    Date,
    Math,
    JSON,
    Map,
    Array,
    Object,
    String,
    Number,
    WebDAV: {
      configured: true,
      async load() { return remoteFile.value ? JSON.parse(JSON.stringify(remoteFile.value)) : null; },
      async save(p) { puts.push(JSON.parse(JSON.stringify(p))); remoteFile.value = JSON.parse(JSON.stringify(p)); return true; },
    },
    window: { addEventListener() {} },
    render() {},
    Sync: { async load() { throw new Error('unused'); }, async save() { throw new Error('unused'); } },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // 只取 util.js 里的 LS / load 两个定义，避免引入无关全局
  vm.runInContext(utilSrc.slice(0, utilSrc.indexOf('/* ------------------------------- 基础工具')) +
    'function load(key, fallback){ try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; } }', ctx);
  vm.runInContext('var cards = [], bills = [];', ctx);
  vm.runInContext(src, ctx);
  // vm 里 const 声明不会挂到 context 上，取出来挂一次
  vm.runInContext('var __Store = Store;', ctx);
  ctx.Store = ctx.__Store;
  ctx.Store.mode = 'webdav';
  return { ctx, puts };
}

let n = 0;
(async () => {
  /* 1. 远端更新更晚 → 远端覆盖本地 */
  {
    const remote = { value: { cards: [{ id: 'c1', name: '远端', updatedAt: 200 }], bills: [] } };
    const { ctx } = makeCtx(remote);
    ctx.cards = [{ id: 'c1', name: '本地', updatedAt: 100 }];
    ctx.bills = [];
    const s = await ctx.Store.load();
    assert.strictEqual(s.cards.find(c => c.id === 'c1').name, '远端');
    n++; console.log('  ✓ 远端 updatedAt 更新时覆盖本地');
  }

  /* 2. 本地更新更晚 → 本地保留 */
  {
    const remote = { value: { cards: [{ id: 'c1', name: '远端', updatedAt: 100 }], bills: [] } };
    const { ctx } = makeCtx(remote);
    ctx.cards = [{ id: 'c1', name: '本地', updatedAt: 200 }];
    ctx.bills = [];
    const s = await ctx.Store.load();
    assert.strictEqual(s.cards.find(c => c.id === 'c1').name, '本地');
    n++; console.log('  ✓ 本地 updatedAt 更新时保留本地');
  }

  /* 3. 本地删除 → 墓碑生效，远端同名记录不会复活 */
  {
    const remote = { value: { cards: [{ id: 'c1', name: '远端', updatedAt: 100 }], bills: [], tomb: { cards: {}, bills: {} } } };
    const { ctx } = makeCtx(remote);
    ctx.cards = [];
    ctx.bills = [];
    ctx.Store.pendingDelete.cards.push('c1');
    const s = await ctx.Store.load();
    assert.strictEqual(s.cards.length, 0, '被删除的卡不应被远端同步回来');
    n++; console.log('  ✓ 本地删除后墓碑阻止远端记录复活');
  }

  /* 4. 远端墓碑 → 本机记录同步删除 */
  {
    const remote = { value: { cards: [], bills: [], tomb: { cards: { c1: 900 }, bills: {} } } };
    const { ctx } = makeCtx(remote);
    ctx.cards = [{ id: 'c1', name: '本机', updatedAt: 100 }];
    ctx.bills = [];
    const s = await ctx.Store.load();
    assert.strictEqual(s.cards.length, 0, '远端墓碑应删除本机旧记录');
    n++; console.log('  ✓ 远端墓碑删除本机记录');
  }

  /* 5. 墓碑之后又编辑过 → 编辑生效（复活） */
  {
    const remote = { value: { cards: [{ id: 'c1', name: '复活', updatedAt: 2000 }], bills: [], tomb: { cards: { c1: 900 }, bills: {} } } };
    const { ctx } = makeCtx(remote);
    ctx.cards = [];
    ctx.bills = [];
    const s = await ctx.Store.load();
    assert.strictEqual(s.cards.length, 1, '墓碑时间早于记录更新时间时应保留记录');
    assert.strictEqual(s.cards[0].name, '复活');
    n++; console.log('  ✓ 删除后又被编辑的记录会保留');
  }

  /* 6. 内容一致时不重复 PUT */
  {
    const remote = { value: { cards: [{ id: 'c1', name: 'A', updatedAt: 100 }], bills: [], tomb: { cards: {}, bills: {} } } };
    const { ctx, puts } = makeCtx(remote);
    ctx.cards = [{ id: 'c1', name: 'A', updatedAt: 100 }];
    ctx.bills = [];
    await ctx.Store.load();
    assert.strictEqual(puts.length, 0, '内容一致时不应回写远端');
    // 改动后再同步应写一次
    ctx.cards = [{ id: 'c1', name: 'B', updatedAt: 300 }];
    await ctx.Store.save(ctx.cards, ctx.bills);
    assert.strictEqual(puts.length, 1, '有变更时应写回一次');
    assert.strictEqual(puts[0].cards[0].name, 'B');
    n += 2; console.log('  ✓ 无变更不回写、有变更写回一次');
  }

  /* 7. 远端文件不存在（404 → null）时自动创建 */
  {
    const remote = { value: null };
    const { ctx, puts } = makeCtx(remote);
    ctx.cards = [{ id: 'c1', name: '首建', updatedAt: 100 }];
    ctx.bills = [];
    await ctx.Store.load();
    assert.strictEqual(puts.length, 1, '远端为空时应创建文件');
    assert.strictEqual(puts[0].app, 'ccms');
    n++; console.log('  ✓ 远端文件不存在时自动创建');
  }

  console.log(`\n${n} 项通过`);
})().catch(e => { console.error('✗ 失败：', e.message); process.exit(1); });
