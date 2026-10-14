const CACHE = 'booth-v1';
const CORE = [
  'index.html', 'styles.css', 'manifest.webmanifest',
  'fonts/fonts.css',
  'src/app.js', 'src/state.js', 'src/layouts.js', 'src/themes.js', 'src/filters.js',
  'src/render.js', 'src/stickers.js', 'src/media.js', 'src/bridge.js', 'src/album.js',
  'src/booth.js', 'src/trim.js', 'src/editor.js', 'src/video-export.js',
  'vendor/mp4-muxer.min.mjs',
  'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
