/**
 * Loaded by vitest.config.ts before every test file.
 *
 * Almost nothing is needed now that tests run under jsdom with the real Svelte
 * compiler: `$state` is compiled properly rather than shimmed, and localStorage is
 * provided by the environment. What's left is making sure no test can leak state
 * into the next one — several stores read storage once at import, so a stray key
 * would silently change what the next file sees.
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup(); // unmount anything still rendered, so effects stop running
  localStorage.clear();
});
