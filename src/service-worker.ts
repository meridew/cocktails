/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
/**
 * Service worker. Two jobs:
 *   1. precache the built app shell so it launches offline
 *   2. receive Web Push and show "your drink" notifications
 *
 * SvelteKit's `$service-worker` module hands over the exact build manifest, so
 * this replaces vite-plugin-pwa + Workbox's injectManifest: `build` is the
 * immutable output (safe to cache forever — filenames are hashed), `files` is
 * everything in static/, and `version` changes every build, which is what makes
 * the old cache identifiable and therefore deletable.
 *
 * That matters: an earlier hand-rolled version used a fixed cache name, so its
 * cleanup step never matched anything and every deploy's superseded bundle
 * accumulated until the origin quota was at risk.
 */
import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `cocktails-${version}`;
const PRECACHE = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Take over from the previous worker immediately, so a deploy doesn't leave
      // a stale shell serving until every tab is closed.
      .then(() => self.skipWaiting()),
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Never cache the API: the queue is live, and a stale order list is worse than
  // an error. Same for anything that isn't a plain GET.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Build assets are content-hashed, so a hit is always correct and always fresh.
      if (PRECACHE.includes(url.pathname)) {
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
      }
      // Everything else: network first, falling back to whatever we have. The app
      // must show live data when there's a connection and still open without one.
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        const hit = await cache.match(request);
        if (hit) return hit;
        throw new Error('offline and not cached');
      }
    })(),
  );
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
    /* non-JSON payload → the defaults below */
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? '🍸 Cocktails', {
      body: data.body ?? '',
      tag: data.tag,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Focus an existing window AND send it to the target — focusing alone ignored
      // the payload's url, so the deep link never actually navigated.
      for (const client of clients) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});

export {};
