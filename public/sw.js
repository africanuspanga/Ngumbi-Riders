/*
 * Ng'umbi Riders service worker (spec §26).
 * - Network-first for navigations with an /offline fallback.
 * - Caches ONLY the app shell / static assets. Never caches NIDA/licence,
 *   receipts, signed contracts, reports or Snippe responses (§26.2).
 * - Handles web-push notifications and notification clicks.
 */
// Bump the version WHENEVER the precached shell (offline page, icons,
// manifest) changes — sw.js bytes must change for browsers to reinstall.
const SHELL_CACHE = 'ngr-shell-v3';
const SHELL_ASSETS = ['/offline', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      // Re-fetch the shell on every activation: the precache otherwise
      // freezes at first install (the offline page would keep referencing
      // that deploy's hashed CSS/JS forever). Best-effort — offline
      // activation keeps the existing entries.
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(SHELL_ASSETS);
      } catch {
        /* offline during activate — keep the previous shell */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Only handle same-origin page navigations; let everything else hit network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        // caches.match can resolve to undefined (evicted / failed install);
        // respondWith(undefined) throws and shows the browser error page.
        const offline = await caches.match('/offline');
        return offline ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: "Ng'umbi Riders", body: '', url: '/' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    /* plain-text or empty push */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Exact-path match only: `includes('/')` would match any open window
      // and focus the wrong page instead of opening the deep link.
      const target = new URL(url, self.location.origin).href;
      for (const client of clients) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
