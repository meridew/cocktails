/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
/**
 * Push-only service worker.
 *
 * The app used to precache and intercept every page request. That produced an
 * offline shell which could not do anything without the API, while a failed install
 * or stale worker could hold the whole origin on an old build. Push is the only
 * feature that needs a worker, so page and asset requests now stay with the browser.
 */

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  const ready = (async () => {
    const keys = await caches.keys();
    const legacy = keys.filter((key) => key.startsWith('cocktails-'));
    await Promise.all(legacy.map((key) => caches.delete(key)));
    await self.clients.claim();
    return legacy.length > 0;
  })();
  event.waitUntil(ready);

  /**
   * The first push-only worker is also the one-time escape hatch for old shells.
   *
   * A legacy cache proves this activation replaced a precaching worker. Reload those
   * clients after activation, when requests can reach the network. Later workers find
   * no legacy cache, so ordinary deploys return to the polite UpdateBar prompt.
   */
  void ready.then(async (hadLegacyCache) => {
    if (!hadLegacyCache) return;
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.navigate(client.url).catch(() => {});
    }
  });
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
      // A later state for the same order replaces its earlier notification. Ask
      // supporting phones to alert again rather than updating that card silently.
      renotify: Boolean(data.tag),
      vibrate: [180, 80, 180],
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
