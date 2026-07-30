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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup(); // unmount anything still rendered, so effects stop running
  localStorage.clear();
});
