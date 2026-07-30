/**
 * Loaded by vite.config.ts before every test file.
 *
 * Almost nothing is needed now that tests run under jsdom with the real Svelte
 * compiler: `$state` is compiled properly rather than shimmed, and localStorage is
 * provided by the environment. What's left is making sure no test can leak state
 * into the next one — several stores read storage once at import, so a stray key
 * would silently change what the next file sees.
 *
 * A few suites opt out of jsdom with `// @vitest-environment node`, because the
 * libraries they exercise check `instanceof` against real Node globals and jsdom's
 * are a different realm. This file runs for those too, so the DOM cleanup is
 * guarded rather than assumed — an unguarded `localStorage.clear()` here failed
 * every test in such a file before it had run a line of its own.
 */
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

/**
 * Must be set before any server module is imported: `config` freezes DB_PATH at
 * import time, and static imports are hoisted, so setting it inside a test file
 * would happen too late. Keeping it here means local and CI runs behave alike.
 *
 * Note also that VAPID keys are deliberately absent — with them unset `push.ts` is
 * inert and the suite makes zero outbound requests. Do not add them.
 */
process.env.DB_PATH ??= ':memory:';

const hasDom = typeof window !== 'undefined';

/**
 * Not just "does localStorage exist".
 *
 * Node 25 added its own `localStorage` global, which shadows jsdom's and has no
 * `clear()` unless `--localstorage-file` points somewhere real. Every DOM test then
 * failed in `beforeEach`, before running a line of its own — 296 of them, on a
 * machine where `brew install node` happened to give 25 rather than the 24 that
 * `package.json` asks for. The engines range now says so; this stays defensive
 * because the failure was so far from its cause.
 */
const canClearStorage = hasDom && typeof globalThis.localStorage?.clear === 'function';

beforeEach(() => {
  if (canClearStorage) localStorage.clear();
});

afterEach(() => {
  if (!hasDom) return;
  cleanup(); // unmount anything still rendered, so effects stop running
  if (canClearStorage) localStorage.clear();
});
