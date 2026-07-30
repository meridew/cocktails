/// <reference lib="webworker" />
/**
 * Custom service worker (injectManifest). Two jobs:
 *   1. precache the built app shell for offline launch
 *   2. receive Web Push and show "your drink" notifications
 *
 * Caching is Workbox's `precacheAndRoute`, which vite-plugin-pwa already pulls in
 * — no new download. It replaced a hand-rolled cache that kept a fixed name
 * (`cocktails-shell-v1`), so its cleanup step never matched anything and every
 * deploy's superseded bundles accumulated forever, eventually risking the origin
 * storage quota. Workbox keys entries by the injected revision and prunes what is
 * no longer in the manifest.
 *
 * Excluded from the app tsconfig — vite-plugin-pwa transpiles it on its own.
 * Dropped entirely for the native build (Capacitor uses APNs/FCM, not Web Push).
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// ---- caching ----

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/**
 * Navigations fall back to the cached shell only when the network fails, so real
 * pages (the app, and /dev.html in development) always load live. `denylist`
 * keeps /api out of the SPA fallback entirely.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
);

// Take over from a previous worker as soon as this one installs, so a deploy
// doesn't leave a stale shell serving until every tab closes.
self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

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
      // Focus an existing window AND send it to the target — focusing alone
      // ignored the payload's url, so the deep link never actually navigated.
      for (const client of clients) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});
