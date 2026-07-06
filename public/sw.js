/*
 * Ng'umbi Riders service worker (spec §26).
 * - Network-first for navigations with an /offline fallback.
 * - Caches ONLY the app shell / static assets. Never caches NIDA/licence,
 *   receipts, signed contracts, reports or Snippe responses (§26.2).
 * - Handles web-push notifications and notification clicks.
 */
const SHELL_CACHE = 'ngr-shell-v1';
const SHELL_ASSETS = ['/offline', '/icons/logo.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Only handle same-origin page navigations; let everything else hit network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline')),
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
      icon: '/icons/logo.png',
      badge: '/icons/logo.png',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
