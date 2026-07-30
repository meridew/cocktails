/**
 * The persisted view store — "come back to where you were".
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
    assert.equal(view.bar, false);
    assert.equal(view.order, false);
    assert.equal(view.favesOnly, false);
    assert.equal(view.barFilter, 'active');
    assert.equal(view.barSort, 'oldest');
  });
});

describe('persistence', () => {
  test('every field is written as it changes and read back on the next visit', async () => {
    const { view } = await freshStore();
    view.bar = true;
    view.order = true;
    view.favesOnly = true;
    view.barFilter = 'making';
    view.barSort = 'newest';

    // The reported bug: reloading in bar mode dropped you back on the menu.
    const { view: reloaded } = await freshStore(readBack());
    assert.equal(reloaded.bar, true, 'a refresh behind the bar must stay behind the bar');
    assert.equal(reloaded.order, true);
    assert.equal(reloaded.favesOnly, true);
    assert.equal(reloaded.barFilter, 'making');
    assert.equal(reloaded.barSort, 'newest');
  });

  test('closing something is persisted too, not just opening it', async () => {
    const { view } = await freshStore({ bar: true, order: true });
    view.bar = false;
    const { view: reloaded } = await freshStore(readBack());
    assert.equal(reloaded.bar, false);
    assert.equal(reloaded.order, true, 'closing one overlay must not close the other');
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
    assert.equal(view.bar, false);
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
    const { view } = await freshStore({ bar: 'yes', order: 1, favesOnly: null });
    assert.equal(view.bar, false);
    assert.equal(view.order, false);
    assert.equal(view.favesOnly, false);
  });

  test('a missing key behaves the same as a first visit', async () => {
    const { view } = await freshStore({});
    assert.equal(view.bar, false);
    assert.equal(view.barFilter, 'active');
  });
});

describe('deep links', () => {
  test('?bartender and ?order open their overlay and are then remembered', async () => {
    const { view, applyDeepLink } = await freshStore();
    applyDeepLink('?bartender');
    assert.equal(view.bar, true);
    // Recorded, so following a "new order" notification survives a reload.
    assert.equal((await freshStore(readBack())).view.bar, true);
  });

  test('a link wins over stored state', async () => {
    const { view, applyDeepLink } = await freshStore({ bar: false });
    applyDeepLink('?bartender');
    assert.equal(view.bar, true);
  });

  test('no link leaves the stored view alone', async () => {
    const { view, applyDeepLink } = await freshStore({ bar: true });
    applyDeepLink('');
    assert.equal(view.bar, true, 'an ordinary reload must not close what was open');
    applyDeepLink('?something=else');
    assert.equal(view.bar, true);
  });
});
