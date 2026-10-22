/* CCMS Service Worker：应用外壳缓存，支持离线访问与 PWA 安装 */
const CACHE = 'ccms-v2';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest',
  './js/util.js', './js/api.js', './js/webdav.js', './js/store.js', './js/modals.js', './js/ui.js', './js/app.js',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;            // 不缓存 POST 等（同步接口走网络）
  const url = new URL(req.url);
  // API 请求始终走网络，保证数据实时
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() => new Response('{"error":"offline"}', { status: 503, headers: { 'content-type': 'application/json' } })));
    return;
  }
  // 站外请求（如用户自建 WebDAV）一律直连，不参与外壳缓存，避免读到过期账本
  if (url.origin !== self.location.origin) return;
  // 应用外壳：缓存优先，回退网络；导航请求回退到 index.html（SPA）
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit)
    )
  );
});
