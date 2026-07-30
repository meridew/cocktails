/**
 * Where the user was: which overlay was open, and how they'd set the bar up.
 *
 * Reloading used to dump you back on the menu, which is wrong everywhere but
 * especially behind the bar — a bartender who refreshes mid-service loses their
 * filter and their place. This is also what makes a native cold start resume
 * rather than restart, so it's a step towards the app builds.
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
  bar: boolean;
  order: boolean;
  favesOnly: boolean;
  barFilter: BarFilter;
  barSort: BarSort;
}

const DEFAULTS: ViewState = {
  bar: false,
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
    bar: raw.bar === true,
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
  get bar() {
    return state.bar;
  },
  set bar(open: boolean) {
    state.bar = open;
    persist();
  },
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
 * Apply the dev-hub / notification deep links (`/?bartender`, `/?order`).
 *
 * A link is an explicit instruction about where to go, so it wins over whatever
 * was stored — and it's recorded, so following a "new order" notification and then
 * reloading keeps you on the bar.
 */
export function applyDeepLink(search: string): void {
  const params = new URLSearchParams(search);
  if (params.has('bartender')) view.bar = true;
  if (params.has('order')) view.order = true;
}
