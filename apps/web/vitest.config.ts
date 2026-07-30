import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Test config for the web app.
 *
 * The API keeps `node:test` — it tests pure functions and in-process HTTP, needs no
 * DOM, and runs in about two seconds. The web app needs something that can compile
 * Svelte and mount components, which is why this exists: previously *every* UI
 * assertion had to go through a real browser, one slow round-trip at a time, and
 * questions as simple as "does this modal appear when nothing is stored yet" cost
 * several of them. Mounting the component answers that in milliseconds.
 *
 * Assertions stay on `node:assert/strict` rather than `expect`, so both suites read
 * the same way and the existing tests carried over unchanged.
 */
export default defineConfig({
  // `hot: false` — HMR has no meaning in a test run and only adds noise.
  plugins: [svelte({ hot: false })],
  resolve: {
    // Required for Svelte 5 under jsdom: without it the *server* build resolves,
    // components render to a string, and nothing is mountable.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Each file gets a fresh module registry, which matters because several stores
    // read localStorage once at import time.
    isolate: true,
    restoreMocks: true,
    // Globals faked with vi.stubGlobal (Notification, PushManager) are restored
    // between tests, so one case's fake browser can't shape the next one's.
    unstubGlobals: true,
  },
});
