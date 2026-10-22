/* =========================================================================
 * CCMS · 应用入口
 * 声明全局状态（cards / bills / view / sel / now），负责导航、初始化、
 * 多设备自动同步（聚焦/可见时拉取）与 PWA Service Worker 注册。
 * 其它模块（util / api / store / modals / ui）通过全局作用域共享本文件声明的状态。
 * ========================================================================= */

let cards = [];
let bills = [];
let view = localStorage.getItem(LS.view) || 'dashboard'; // 当前导航视图，刷新后保持
let focusCardId = ''; // 概览页点击卡面后，在账单月度视图中聚焦该卡
let billPartition = localStorage.getItem(LS.billTab) || 'monthly'; // 账单模块内的分区：monthly | annual
let cardPartition = localStorage.getItem(LS.cardTab) || 'active';  // 信用卡模块内的分区：active | closed
let cardView = localStorage.getItem(LS.cardView) || 'card'; // 信用卡视图：card | list | image（本地记忆）
const now = new Date();
const sel = { year: now.getFullYear(), month: now.getMonth() + 1 };

/* ------------------------------- 导航 ------------------------------- */
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => {
  view = b.dataset.view;
  if (view === 'bills') focusCardId = ''; // 通过导航进入账单时取消聚焦
  try { localStorage.setItem(LS.view, view); } catch (e) { /* 隐私模式忽略 */ }
  render();
});

/* ------------------------------- 主题 / 语言 ------------------------------- */
function updateThemeBtn() {
  const btn = document.getElementById('themeBtn');
  if (btn) btn.innerHTML = svgIcon(getTheme() === 'dark' ? 'sun' : 'moon', '', 18);
}
// 语言切换按钮：与主题按钮同款图标样式，点击在中/英之间直接切换
function updateLangBtn() {
  const btn = document.getElementById('langBtn');
  if (!btn) return;
  btn.innerHTML = svgIcon('globe', '', 18);
  const tip = lang === 'zh' ? '切换到 English' : 'Switch to 中文';
  btn.title = tip;
  btn.setAttribute('aria-label', tip);
}
function initThemeLang() {
  setTheme(getTheme());
  updateThemeBtn();
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.onclick = () => { toggleTheme(); updateThemeBtn(); };
  updateLangBtn();
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.onclick = () => { setLang(lang === 'zh' ? 'en' : 'zh'); };
}

/* ------------------------------- 多设备自动同步 ------------------------------- */
// 云端 / WebDAV 模式下：窗口重新聚焦 / 页面重新可见时，自动拉取远端最新数据
let pullTimer = null;
async function autoPull() {
  if (!Store.isCloud && !Store.isWebdav) return;
  try {
    const s = await Store.load();
    cards = s.cards; bills = s.bills;
    if (Store.isCloud) {
      try {
        const me = await Auth.me();
        if (me && me.nickname) setNickname(me.nickname);
      } catch (e) { /* 昵称同步失败不阻断 */ }
    }
    render();
  } catch (e) { /* 静默失败，下次聚焦再试 */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoPull(); });
window.addEventListener('focus', () => { clearTimeout(pullTimer); pullTimer = setTimeout(autoPull, 800); });

/* ------------------------------- PWA Service Worker ------------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 忽略：本地 file:// 等环境不支持 */ });
  });
}

/* ------------------------------- 初始化 ------------------------------- */
(async function init() {
  initThemeLang();
  try {
    const s = await Store.load(); // 登录态下(isCloud)自动拉取云端；否则读本地
    cards = s.cards; bills = s.bills;
    // 云端模式下同步昵称（跨设备）。仅当云端有非空昵称时覆盖本地，避免空值覆盖。
    if (Store.isCloud) {
      try {
        const me = await Auth.me();
        if (me && me.nickname) setNickname(me.nickname);
      } catch (e) { /* 昵称同步失败不阻断加载 */ }
    }
  } catch (e) {
    console.error(e);
    alert('数据加载失败：' + e.message + '\n（若已启用云端账户，请确认已部署 Worker 与 D1）');
  }
  updateSyncState();
  render();
})();
