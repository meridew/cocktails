import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * One adapter: `adapter-node`, which produces `build/index.js` — a plain Node
 * server that serves the app *and* `/api` from one process. That's what the NAS
 * container runs, and it's what `npm run preview` runs locally, so local and
 * production are the same artifact.
 *
 * `adapter-static` for the Capacitor build is deliberately not here yet: that
 * build has never been exercised end to end (no Android SDK, no Mac), and
 * carrying an unverifiable second target through this migration is exactly the
 * complexity it's meant to remove.
 *
 * @type {import('@sveltejs/kit').Config}
 */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    /*
     * Web Push needs a service worker; SvelteKit registers src/service-worker.ts
     * automatically in production and leaves it alone in dev.
     *
     * `updateViaCache: 'none'` is load-bearing, and this is the bug it fixes.
     *
     * The origin sends no `Cache-Control` for `/service-worker.js`, because
     * adapter-node's sirv only sets one for `/_app/immutable/`. Cloudflare therefore
     * applies its default browser-cache TTL to it — the path ends in `.js`, so it is
     * treated as a static asset — and serves it from the edge:
     *
     *     Cache-Control: max-age=14400
     *     cf-cache-status: HIT
     *
     * So for four hours after any deploy, a *fresh registration* could be handed the
     * **previous** service worker. Reported from an Android phone: refreshing Chrome
     * showed the new version, then reinstalling the PWA brought the old one back —
     * and took Chrome with it, because a service worker is scoped to the origin, not
     * to the tab. An old worker that activates also runs its own `activate` cleanup,
     * which deletes every cache that is not its own, including the current one.
     *
     * `'none'` makes the browser fetch this script bypassing its **own** HTTP cache.
     * That is worth having and it is not the whole fix — an earlier version of this
     * comment claimed it was, and testing said otherwise:
     *
     *     curl -H 'Cache-Control: no-cache' …/service-worker.js
     *     cf-cache-status: HIT      Age: 929      (identical to the plain request)
     *
     * Cloudflare's documented rule is that it declines to cache when the **origin**
     * response carries `no-store`, `private`, `no-cache` or `max-age=0`. Request
     * headers do not enter into it. So the edge keeps answering from its copy for the
     * full four hours no matter what the browser asks for, and the real fix has to
     * come from the origin or from Cloudflare.
     *
     * Neither is possible from here: adapter-node serves static files through sirv
     * with no way to configure it — `setHeaders` is hard-coded to `/_app/immutable/`
     * (sveltejs/kit#11875, #2060, #3194) — so this file cannot set a header on
     * `/service-worker.js`. The two real options are a Cloudflare cache rule
     * bypassing that path, or adapter-node's documented custom-server pattern:
     * import `build/handler.js`, set `cache-control: no-cache` for that one path,
     * delegate everything else. The latter fixes the origin and so holds for any CDN,
     * at the cost of owning the entry point that launchd starts.
     */
    serviceWorker: { register: true, options: { updateViaCache: 'none' } },

    /*
     * Poll for a new build, so a tab that stays open finds out about one.
     *
     * The service worker already handles this correctly *at the boundary* —
     * `skipWaiting()` and `clients.claim()` mean a new worker takes over at once,
     * and the old cache is deleted. What neither does is reload the page, so an app
     * left open on a phone keeps running the JavaScript it booted with, forever, and
     * nothing on screen ever says otherwise. That is the half of "I can't refresh to
     * get the latest version" that survives deploying properly.
     *
     * SvelteKit polls `/_app/version.json` and flips `updated.current`, which is
     * `UpdateBar.svelte`'s cue. Using the framework's mechanism rather than a version
     * header on our own polls: it exists, it is tested, and reaching past a working
     * primitive to hand-roll one is the mistake that shipped a modal with no focus
     * trap earlier today.
     *
     * A minute is frequent enough that nobody is stuck on a stale build for long and
     * rare enough to be nothing next to the bar's own 4s order poll.
     */
    version: { pollInterval: 60_000 },
  },
};
