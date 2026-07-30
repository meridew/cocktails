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
 * complexity it's meant to remove. See docs/archive/SVELTEKIT-PLAN.md §8.
 *
 * @type {import('@sveltejs/kit').Config}
 */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Web Push needs a service worker; SvelteKit registers src/service-worker.ts
    // automatically in production and leaves it alone in dev.
    serviceWorker: { register: true },
  },
};
