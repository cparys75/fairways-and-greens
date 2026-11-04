// Keeps the app usable with a weak or missing signal on the course:
// - the app itself (HTML and hashed assets) is cached, so it opens offline;
// - signed-in reads (/api/me, seasons, your matches and rounds) fall back to the last copy offline;
// - writes are never cached; the app queues them itself (src/app/offline.ts).
const APP = 'golf-league-app-v3';
const DATA = 'golf-league-data-v1';
const READS = [/^\/api\/me$/, /^\/api\/seasons/, /^\/api\/my\//];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['/', '/logo.svg', '/logo-mark.webp', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== DATA).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const put = (cache, key, res) => caches.open(cache).then((c) => c.put(key, res));

// Network first, but don't wait forever on one bar of signal.
const networkFirst = (request, cache, key, timeoutMs) =>
  new Promise((resolve) => {
    let done = false;
    const fallback = () =>
      caches.match(key).then((hit) => {
        if (!done && hit) {
          done = true;
          resolve(hit);
        }
        return hit;
      });
    const timer = setTimeout(fallback, timeoutMs);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) put(cache, key, res.clone());
        if (!done) {
          done = true;
          resolve(res);
        }
      })
      .catch(async () => {
        clearTimeout(timer);
        const hit = await fallback();
        if (!done) {
          done = true;
          resolve(hit ?? Response.error());
        }
      });
  });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === '/api/logout') {
    // Signing out: forget the signed-in user's cached data.
    e.waitUntil(caches.delete(DATA));
    return;
  }
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request, APP, '/', 4000));
  } else if (url.pathname.startsWith('/assets/')) {
    // Built files have content hashes in their names, so a cached copy never goes stale.
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((res) => (res.ok && put(APP, e.request, res.clone()), res))));
  } else if (READS.some((r) => r.test(url.pathname))) {
    e.respondWith(networkFirst(e.request, DATA, e.request, 6000));
  }
});

// --- Push notifications ---
// Content-less push: wake up, fetch what's queued for this signed-in user, and show it.
self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      let items = [];
      try {
        const r = await fetch('/api/push/pending', { credentials: 'include' });
        if (r.ok) items = await r.json();
      } catch {
        /* offline; show a generic nudge below */
      }
      if (!items.length) {
        await self.registration.showNotification('Fairways and Greens', { body: 'Open the app for the latest.', icon: '/logo.svg', badge: '/logo.svg' });
        return;
      }
      await Promise.all(
        items.map((n) =>
          self.registration.showNotification(n.title, { body: n.body, icon: '/logo.svg', badge: '/logo.svg', tag: 'n-' + n.id, data: { url: n.url || '/' } }),
        ),
      );
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hit = wins.find((w) => w.url.includes(url));
      if (hit) return hit.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
