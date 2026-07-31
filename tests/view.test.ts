// @vitest-environment jsdom
/**
 * The persisted view store — the parts of "where you were" that a URL can't say.
 *
 * The bar used to be a `bar: boolean` here, faking route state so a refresh didn't
 * dump a bartender back on the menu. It's `/bar` now, so the browser handles it and
 * the flag is gone. What's left is genuinely not addressable.
 *
 * The store reads storage once at import, so each case that needs a different
 * starting point seeds localStorage and then imports a fresh copy of the module.
 * (jsdom provides localStorage; runes are compiled for real.)
 */
import { test, describe, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { ORDER_STATUSES } from '$lib/shared';
import type { BarFilter } from '$lib/stores/view.svelte';

const KEY = 'cocktail_view';

/**
 * Import a fresh instance of the store, so module-level `load()` re-runs against
 * whatever was just put in storage — that's the "next visit" this file is about.
 */
async function freshStore(stored?: unknown) {
  if (stored === undefined) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, typeof stored === 'string' ? stored : JSON.stringify(stored));
  vi.resetModules();
  return import('$lib/stores/view.svelte');
}

const readBack = () => JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;

beforeEach(() => localStorage.clear());

describe('defaults', () => {
  test('a first visit opens on the menu with the standard queue setup', async () => {
    const { view } = await freshStore();
    assert.equal(view.order, false);
    assert.equal(view.favesOnly, false);
    assert.equal(view.barFilter, 'active');
    assert.equal(view.barSort, 'oldest');
  });
});

describe('persistence', () => {
  test('every field is written as it changes and read back on the next visit', async () => {
    const { view } = await freshStore();
    view.order = true;
    view.favesOnly = true;
    view.barFilter = 'making';
    view.barSort = 'newest';

    // A bartender who refreshes mid-service keeps their queue setup. (Staying *on*
    // the bar is the router's job now, not this store's.)
    const { view: reloaded } = await freshStore(readBack());
    assert.equal(reloaded.order, true);
    assert.equal(reloaded.favesOnly, true);
    assert.equal(reloaded.barFilter, 'making');
    assert.equal(reloaded.barSort, 'newest');
  });

  test('closing something is persisted too, not just opening it', async () => {
    const { view } = await freshStore({ order: true, favesOnly: true });
    view.order = false;
    const { view: reloaded } = await freshStore(readBack());
    assert.equal(reloaded.order, false);
    assert.equal(reloaded.favesOnly, true, 'closing one thing must not reset another');
  });

  test('every real filter and sort value round-trips', async () => {
    const filters: BarFilter[] = ['active', ...ORDER_STATUSES];
    for (const filter of filters) {
      const { view } = await freshStore();
      view.barFilter = filter;
      assert.equal((await freshStore(readBack())).view.barFilter, filter);
    }
    for (const sort of ['oldest', 'newest'] as const) {
      const { view } = await freshStore();
      view.barSort = sort;
      assert.equal((await freshStore(readBack())).view.barSort, sort);
    }
  });
});

describe('stored values are never trusted', () => {
  test('corrupt JSON falls back to defaults instead of throwing', async () => {
    const { view } = await freshStore('{not json');
    assert.equal(view.order, false);
    assert.equal(view.barFilter, 'active');
  });

  test('an unknown filter or sort falls back rather than wedging the queue', async () => {
    // A value from an older build (or a hand-edited one) must not leave the bar
    // showing a filter that matches nothing, with no way to tell why.
    const { view } = await freshStore({ barFilter: 'archived', barSort: 'sideways' });
    assert.equal(view.barFilter, 'active');
    assert.equal(view.barSort, 'oldest');
  });

  test('non-boolean flags are coerced, not passed through', async () => {
    const { view } = await freshStore({ order: 1, favesOnly: null });
    assert.equal(view.order, false);
    assert.equal(view.favesOnly, false);
  });

  test('a missing key behaves the same as a first visit', async () => {
    const { view } = await freshStore({});
    assert.equal(view.order, false);
    assert.equal(view.barFilter, 'active');
  });
});

describe('deep links', () => {
  test('?order opens the order sheet and is then remembered', async () => {
    const { view, applyDeepLink } = await freshStore();
    applyDeepLink('?order');
    assert.equal(view.order, true);
    assert.equal((await freshStore(readBack())).view.order, true);
  });

  test('no link leaves the stored state alone', async () => {
    const { view, applyDeepLink } = await freshStore({ order: true });
    applyDeepLink('');
    assert.equal(view.order, true, 'an ordinary reload must not close what was open');
    applyDeepLink('?something=else');
    assert.equal(view.order, true);
  });

  test('?bartender is not handled here any more', async () => {
    // It's a route redirect in +page.svelte now — notifications sent before the
    // move still carry the old URL, so it can't simply be dropped.
    const { view, applyDeepLink } = await freshStore();
    applyDeepLink('?bartender');
    assert.equal(view.order, false, 'the old link must not toggle anything here');
  });
});
