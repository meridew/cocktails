/**
 * Where the user was, for the parts of it the URL can't say.
 *
 * The bar used to live here as a `bar: boolean`, because it was an overlay and a
 * refresh would otherwise dump a bartender back on the menu mid-service. It's a
 * route now — `/bar` — so the browser carries that state for free, and back,
 * forward and reload all behave the way people expect without any help from us.
 *
 * What's left is genuinely not addressable: whether the order sheet is showing,
 * whether the menu is filtered to favourites, and how the bartender has their queue
 * sorted. Those persist so a reload doesn't reset the setup.
 *
 * Deliberately *not* persisted: the drink configurator. Its half-made selections
 * live in the component, so restoring the shell without them would reopen a dialog
 * that had silently forgotten what you'd chosen.
 */
import { ORDER_STATUSES } from '$lib/shared';
import type { OrderStatus } from '$lib/shared';
import { storage } from '$lib/storage';

const KEY = 'view';

/** Bar queue filter: everything unfinished, or one specific status. */
export type BarFilter = 'active' | OrderStatus;
export type BarSort = 'oldest' | 'newest';

interface ViewState {
  order: boolean;
  favesOnly: boolean;
  barFilter: BarFilter;
  barSort: BarSort;
}

const DEFAULTS: ViewState = {
  order: false,
  favesOnly: false,
  barFilter: 'active',
  barSort: 'oldest',
};

const BAR_FILTERS: BarFilter[] = ['active', ...ORDER_STATUSES];
const BAR_SORTS: BarSort[] = ['oldest', 'newest'];

/**
 * Read persisted state, field by field. A stored value written by an older build
 * (or hand-edited) must never leave the app in an impossible state, so anything
 * unrecognised falls back to its default rather than being trusted.
 */
function load(): ViewState {
  const raw = storage.readJSON<Partial<ViewState>>(KEY, {});
  const pick = <T>(value: unknown, allowed: T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    order: raw.order === true,
    favesOnly: raw.favesOnly === true,
    barFilter: pick(raw.barFilter, BAR_FILTERS, DEFAULTS.barFilter),
    barSort: pick(raw.barSort, BAR_SORTS, DEFAULTS.barSort),
  };
}

const state = $state<ViewState>(load());

/** One write per change, so nothing has to remember to save. */
function persist(): void {
  storage.writeJSON(KEY, state);
}

export const view = {
  get order() {
    return state.order;
  },
  set order(open: boolean) {
    state.order = open;
    persist();
  },
  get favesOnly() {
    return state.favesOnly;
  },
  set favesOnly(on: boolean) {
    state.favesOnly = on;
    persist();
  },
  get barFilter() {
    return state.barFilter;
  },
  set barFilter(filter: BarFilter) {
    state.barFilter = filter;
    persist();
  },
  get barSort() {
    return state.barSort;
  },
  set barSort(sort: BarSort) {
    state.barSort = sort;
    persist();
  },
};

/**
 * The settings sheet, which any route can raise.
 *
 * Not persisted: reopening the app into a settings dialog nobody asked for would be
 * an odd place to land.
 */
export const settings = $state({ open: false });

/**
 * Honour the legacy `?order` deep link.
 *
 * `?bartender` is gone — that's `/bar` now — but notifications already sent carry
 * the old URL, so +page.svelte redirects it rather than silently landing on the menu.
 */
export function applyDeepLink(search: string): void {
  if (new URLSearchParams(search).has('order')) view.order = true;
}
