/* =========================================================================
 * CCMS · 应用入口
 * 声明全局状态（cards / bills / view / sel / now），负责导航、初始化、
 * 多设备自动同步（聚焦/可见时拉取）与 PWA Service Worker 注册。
 * 其它模块（util / api / store / modals / ui）通过全局作用域共享本文件声明的状态。
 * ========================================================================= */

let cards = [];
let bills = [];
let view = 'dashboard';
const now = new Date();
const sel = { year: now.getFullYear(), month: now.getMonth() + 1 };

/* ------------------------------- 导航 ------------------------------- */
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });

/* ------------------------------- 多设备自动同步 ------------------------------- */
// 云端模式下：窗口重新聚焦 / 页面重新可见时，自动拉取云端最新数据
let pullTimer = null;
async function autoPull() {
  if (!Store.isCloud) return;
  try {
    const s = await Store.load();
    cards = s.cards; bills = s.bills;
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
  try {
    const s = await Store.load(); // 登录态下(isCloud)自动拉取云端；否则读本地
    cards = s.cards; bills = s.bills;
  } catch (e) {
    console.error(e);
    alert('数据加载失败：' + e.message + '\n（若已启用云端账户，请确认已部署 Worker 与 D1）');
  }
  updateSyncState();
  render();
})();
