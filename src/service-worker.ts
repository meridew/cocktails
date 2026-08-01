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
 *
 * ## The cleanup below only behaves if *this file* is never served stale
 *
 * `activate` deletes every cache that is not this worker's own. That is right for
 * the newest worker and destructive for an old one: a superseded worker that gets
 * registered will delete the current cache and then serve its own. Cloudflare was
 * edge-caching `/service-worker.js` for four hours, which made exactly that
 * reachable — see the note on `updateViaCache` in svelte.config.js. The registration
 * option is the fix; this comment is here so the cleanup is not "simplified" later
 * by someone who reads it as unconditionally safe.
 */
import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `cocktails-${version}`;
const PRECACHE = [...build, ...files];

/**
 * **Temporary. Flip back to `false` and deploy once the stragglers are through.**
 *
 * Reload every open page the moment this worker takes over, rather than letting it
 * finish its session on the JavaScript it booted with. Normally that is exactly what
 * we refuse to do — see `UpdateBar.svelte`, which asks instead, because an
 * unrequested reload could land on a bartender halfway through a round of nine.
 *
 * It is on because iPhones are stuck on a build from before any of the worker fixes
 * and will not come forward. The round survives it — the basket is written to storage
 * on every change — so the cost is a jolt, not lost work.
 */
const EVACUATE = true;

/**
 * Whether this worker is *replacing* one, rather than arriving somewhere new.
 *
 * `registration.active` during `install` is the worker being superseded, so this is
 * null exactly when nobody has been here before. That distinction is what stops the
 * evacuation being brutish: a first-time visitor's page has this moment's code
 * already and reloading it would be a flicker that achieved nothing.
 *
 * It is also what the end-to-end suite noticed — eight specs failed on the first
 * run, because a fresh install reloaded the page out from under Playwright
 * mid-click. A browser being surprised by it is a fair proxy for a person.
 */
let replacing = false;

self.addEventListener('install', (event) => {
  replacing = self.registration.active !== null;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      /**
       * **One at a time, because `addAll` is atomic.**
       *
       * `cache.addAll(PRECACHE)` rejects entirely if *any* of its 72 requests fails —
       * and a rejected `install` means the worker never installs, never reaches
       * `skipWaiting()` below, and the previous worker keeps control of the origin
       * indefinitely. On a phone on a party's wifi, one timeout is enough.
       *
       * Every entry answers 200 from here, so this was never going to show up in
       * testing on a desk. It is the difference between "one asset is missing from
       * the offline shell" and "this device can never be updated again", which is not
       * a trade worth keeping for the atomicity.
       *
       * A skipped entry costs nothing while online: the fetch handler's precache
       * branch misses and falls through to network-first.
       */
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            await cache.add(path);
          } catch {
            /* left out of the shell; network-first still serves it */
          }
        }),
      );
      // Take over from the previous worker immediately, so a deploy doesn't leave
      // a stale shell serving until every tab is closed.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  const ready = (async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })();
  event.waitUntil(ready);

  if (!EVACUATE || !replacing) return;
  /**
   * **Outside `waitUntil`, and deliberately not awaited. Both matter.**
   *
   * `waitUntil` holds the worker in *activating*, and its `fetch` handler does not
   * serve anything until that finishes. Navigating a client issues a request this
   * very worker must answer — so awaiting the navigation inside the activation
   * deadlocks: activation waits for the navigation, the navigation waits for
   * activation. Written that way first, and it hung the tab hard enough that even
   * reading the page timed out.
   *
   * So: chained after activation has settled, and fired without waiting for it.
   *
   * `navigate` rather than a `postMessage`, because the pages most in need of moving
   * are running old code with no listener to receive one. Not supported everywhere,
   * so failures are swallowed — claiming above already means their *next* navigation
   * is served fresh regardless.
   */
  void ready.then(async () => {
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.navigate(client.url).catch(() => {});
    }
  });
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
