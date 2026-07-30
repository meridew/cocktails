import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/**
 * One config for dev, build and test — the whole point of the collapse. There is no
 * proxy, no second dev server and no port-pinning hack, because `/api` is served by
 * the same process as the app.
 */
export default defineConfig({
  plugins: [sveltekit()],
  // `vite dev` ignores PORT by default, which leaves anything that assigns one (a
  // container, CI, the preview harness) talking to the wrong place. The built
  // server already honours it, so this makes dev match.
  server: { port: Number(process.env.PORT) || 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Server modules read `$env` and open SQLite at import; a fresh registry per
    // file keeps one test's database out of the next one's.
    isolate: true,
    restoreMocks: true,
    // Globals faked with vi.stubGlobal (Notification, PushManager) are restored
    // between tests, so one case's fake browser can't shape the next one's.
    unstubGlobals: true,
    // The request log in hooks.server.ts is useful in production and pure noise
    // across a few hundred tests; keep it for failures only.
    silent: 'passed-only',
    /**
     * The test environment, stated rather than inherited. `.env` holds real VAPID
     * keys and the real PIN; with those in scope, push.ts would be live and the
     * order-status tests would make outbound calls to real push services.
     */
    env: {
      DB_PATH: ':memory:',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      STAFF_PIN: '',
      STAFF_EMAIL: '',
      STAFF_PASSWORD: '',
    },
  },
  // Svelte 5 under jsdom must resolve its *browser* build, or components render to
  // a string and nothing is mountable. Scoped to test runs so it can't affect the
  // server build, where SvelteKit picks conditions itself.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
});
