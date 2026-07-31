import { DRINKS } from './data';
import type { MenuItem } from './api';

/**
 * A card's emoji: the drink's own if it has one, otherwise its base spirit's.
 *
 * The six house drinks carry hand-picked emoji. The generated 270 don't, and a wall
 * of identical glasses is worse than a wall of none — so the base spirit picks one,
 * which at least groups the cards by eye the way the list groups them by heading.
 *
 * Lives here rather than on the guest page because there are two menus now, flat and
 * 3D, and a drink showing a different face depending on which one you opened would
 * be a small, constant wrongness.
 */
const BASE_EMOJI: Record<string, string> = {
  Gin: '🌿',
  Vodka: '❄️',
  Rum: '🏝️',
  'White Rum': '🏝️',
  'Dark Rum': '🥥',
  'Aged Rum': '🛢️',
  Tequila: '🌵',
  Mezcal: '🔥',
  Whiskey: '🥃',
  Whisky: '🥃',
  'Irish Whiskey': '☘️',
  Bourbon: '🥃',
  Rye: '🥃',
  Scotch: '🥃',
  Brandy: '🍇',
  Cognac: '🍇',
  Champagne: '🍾',
  Prosecco: '🍾',
  Wine: '🍷',
  Beer: '🍺',
  Cachaça: '🇧🇷',
  Pisco: '🍋',
  Absinthe: '🧚',
  Aperol: '🧡',
  Aperitivo: '🍊',
  Campari: '❤️',
  Vermouth: '🍸',
  'Apple Brandy': '🍎',
  Aquavit: '⚓',
  Genever: '🇳🇱',
  Port: '🇵🇹',
  Sake: '🍶',
  Sherry: '🇪🇸',
  /** Seedlip and the rest. 17 drinks, and the one shelf a generic glass serves worst. */
  'Alcohol-Free': '🌱',
};

export const emojiFor = (item: MenuItem): string =>
  DRINKS.find((d) => d.name === item.name)?.emoji ?? BASE_EMOJI[item.base] ?? '🍸';

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
