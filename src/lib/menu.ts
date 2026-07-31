import type { MenuItem } from './api';

/**
 * Searching and grouping a menu, in one place.
 *
 * This was written twice, verbatim — once on the guest's menu and once on the
 * curation board — because both screens want the same thing: a long list narrowed by
 * a search box and broken up by base spirit. The copies were identical but for the
 * name of the variable holding the query, which is the kind of duplication that
 * survives review precisely because it looks like a small local helper each time.
 *
 * Two screens sorting the same drinks differently would be a bug nobody would ever
 * file: it would just read as the app being slightly untrustworthy.
 */
export interface MenuGroup {
  base: string;
  list: MenuItem[];
}

/**
 * Group by base spirit, alphabetical within and between, filtered by `query`.
 *
 * The query matches name *or* base, so "gin" finds the Gin group and "neg" finds the
 * Negroni. Empty groups are dropped by construction — a heading with nothing under
 * it reads as a loading failure.
 */
export function groupByBase(items: MenuItem[], query = ''): MenuGroup[] {
  const q = query.trim().toLowerCase();
  const hits = q
    ? items.filter((i) => i.name.toLowerCase().includes(q) || i.base.toLowerCase().includes(q))
    : items;

  const by = new Map<string, MenuItem[]>();
  for (const item of hits) {
    // A recipe with no base is a data gap, not a reason to vanish from the menu.
    const key = item.base || 'Other';
    (by.get(key) ?? by.set(key, []).get(key)!).push(item);
  }

  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([base, list]) => ({ base, list: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}
