// Minimal offline shell cache. Network first so updates land immediately;
// falls back to cache when offline. Relay traffic is WebSocket and unaffected.
const CACHE = 'closechat-v7';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './hls.light.min.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

// Incoming-call notifications carry Accept/Decline actions; forward the choice
// to the open CloseChat window (or open one) so the call can be answered from
// the notification while the app is in the background.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action || 'open';
  const data = e.notification.data || {};
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    let client = list.find((c) => c.url.startsWith(self.registration.scope)) || list[0];
    if (client) { try { await client.focus(); } catch {} client.postMessage({ type: 'notification', action, data }); return; }
    const w = await self.clients.openWindow('./');
    if (w) setTimeout(() => w.postMessage({ type: 'notification', action, data }), 1500);
  }));
});

// Web Push from the Chatly push server: payload is only { kind: 'message'|'call', from: <pubkey> }.
// If a Chatly window is on screen it already handles it via the relays, so stay quiet.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  const call = d.kind === 'call';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const onScreen = list.some((c) => c.url.startsWith(self.registration.scope) && c.visibilityState === 'visible');
    if (onScreen && !call) return;
    return self.registration.showNotification(call ? 'Incoming call' : 'New message', {
      body: call ? 'Open Chatly to answer' : 'Open Chatly to read it',
      tag: call ? 'call' : d.from ? 'chat:' + d.from : 'push', renotify: true, requireInteraction: call,
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: call ? [400, 200, 400, 200, 400] : [120],
      data: { kind: call ? 'call' : 'message', chatId: d.from || '' },
    });
  }));
});
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((c) => c.postMessage({ type: 'pushchange' }))));
});
