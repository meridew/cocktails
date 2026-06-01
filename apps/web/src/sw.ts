/// <reference lib="webworker" />
/**
 * Custom service worker (injectManifest). Two jobs:
 *   1. precache the built app shell for offline launch
 *   2. receive Web Push and show "your drink" notifications
 *
 * Hand-rolled (no workbox runtime) to stay dependency-light. Excluded from the
 * app tsconfig — vite-plugin-pwa transpiles it on its own. Dropped entirely for
 * the native build (Capacitor uses APNs/FCM, not Web Push).
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

const CACHE = 'cocktails-shell-v1';
// Injected at build time (replaced in place by vite-plugin-pwa).
const manifest = self.__WB_MANIFEST;
const ASSETS = Array.isArray(manifest) ? manifest.map((e) => e.url) : [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()), // never block activation on a cache miss
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Navigations: network-first so real pages (the app, /dev.html) load live and
// only fall back to the cached shell when offline. Other GETs: cache-first for
// the precached assets, else network. /api + cross-origin always hit network.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())));
    return;
  }
  event.respondWith(caches.match(request).then((r) => r ?? fetch(request)));
});

// ---- Web Push ----
interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    if (event.data) data = event.data.json() as PushPayload;
  } catch {
    /* non-JSON payload → defaults below */
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? '🍸 Cocktails', {
      body: data.body ?? '',
      tag: data.tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
