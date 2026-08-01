/**
 * The 270-recipe engine, ported from the legacy flat app.
 *
 * Two questions get asked of this data, and the plan assumed they were the same
 * one. They are not — they are opposite directions through the same set:
 *
 *   • **Make-a-Drink** walks the guest through choices. "Which recipes contain
 *     everything I've picked so far?" — `picked ⊆ recipe.ingredients`.
 *   • **The host's cupboard** asks what tonight can support. "Which recipes need
 *     nothing I haven't got?" — `recipe.ingredients ⊆ stock`.
 *
 * Supersets one way, subsets the other. Sharing the data is the win; sharing the
 * predicate would have been a bug, and a quiet one — with a small stock, using
 * `reachable()` would have returned the elaborate recipes rather than the simple
 * ones, which reads as "the generator is a bit odd" rather than "it is wrong".
 */
import data from './data/cocktails.json';

export type Category =
  | 'liquor'
  | 'wine'
  | 'citrus'
  | 'juice'
  | 'sweetener'
  | 'bitters'
  | 'texture'
  | 'herb'
  | 'top'
  | 'aromatic'
  | 'finish'
  | 'method';

export interface Recipe {
  id: string;
  name: string;
  /** The spirit it's built on. Not necessarily present in `INGREDIENTS` — see BASES. */
  base: string;
  /** Optional guest-menu heading when the stocked base is more specific. */
  menuBase?: string;
  /** Everything else, including the build method as a pseudo-ingredient. */
  ingredients: string[];
  garnish?: string;
  ice?: string;
  glass?: string;
  blurb?: string;
  method?: string;
  /** A measured house build. Recipes without one still expose composition and serve data. */
  spec?: RecipeSpec;
}

export interface RecipeSpec {
  measures: { ingredient: string; amount: string }[];
  /** Short original instructions written for the bar screen, not copied source prose. */
  steps: string[];
  source: { label: string; url?: string };
}

export const CATEGORY_ORDER = data.categoryOrder as Category[];
export const CATEGORY_LABELS = data.categoryLabels as Record<Category, string>;
export const INGREDIENTS = data.ingredients as Record<string, Category>;
export const RECIPES = data.cocktails as Recipe[];

/** Every base spirit any recipe is built on. */
export const BASES: string[] = [...new Set(RECIPES.map((r) => r.base))].sort();

/**
 * Categories that describe a *technique* rather than a bottle.
 *
 * "Shaken" is listed among a recipe's ingredients so the interactive walk can ask
 * about it, but nobody stocks it. Left in, every recipe would look unmakeable until
 * the host ticked "Stirred", which is nonsense.
 */
export const NON_STOCKABLE: ReadonlySet<Category> = new Set<Category>(['method']);

/**
 * Everything a host could plausibly say they have in.
 *
 * Deliberately `BASES ∪ INGREDIENTS`, not just the ingredient table: **12 of the 25
 * bases are absent from that table** — White Rum, Sherry, Aquavit and others are
 * only ever named as a `base`. Building the stock list from `INGREDIENTS` alone
 * would have made every drink built on them permanently unmakeable, with nothing to
 * tick to fix it.
 */
export const STOCKABLE: string[] = [
  ...new Set([
    ...BASES,
    ...Object.keys(INGREDIENTS).filter((i) => !NON_STOCKABLE.has(INGREDIENTS[i]!)),
  ]),
].sort();

/** Which category an ingredient belongs to, or undefined for a base with no entry. */
export const categoryOf = (ingredient: string): Category | undefined => INGREDIENTS[ingredient];

/**
 * Headings for the stock screen.
 *
 * Deliberately **not** `CATEGORY_LABELS`, which are the interactive walk's questions
 * — "A squeeze of citrus?" is the right thing to ask a guest choosing a drink and the
 * wrong thing to print above a column of checkboxes. Same categories, different job,
 * so a second set of words rather than one set stretched over both.
 */
export const SHELF_LABELS: Record<Category, string> = {
  liquor: 'Spirits & liqueurs',
  wine: 'Wine',
  citrus: 'Citrus',
  juice: 'Juices',
  sweetener: 'Sweet',
  bitters: 'Bitters',
  texture: 'Egg & cream',
  herb: 'Herbs & muddles',
  top: 'Mixers',
  aromatic: 'Savoury & spice',
  finish: 'Garnishes',
  method: 'How it is built',
};

/**
 * `STOCKABLE` arranged for a human to work down — the shape the stock screen needs.
 *
 * A flat alphabetical list of ~100 bottles is a search task; grouped into ten
 * headings it's a walk through a cupboard. The order is `categoryOrder`, which the
 * legacy app already tuned for the interactive walk (spirit first, garnish last), so
 * a host meets the decisions that matter most while they still care.
 *
 * The 12 bases with no entry in the ingredients table — White Rum, Sherry, Aquavit
 * and the rest — are filed under `liquor`. That is not a guess: a `base` is by
 * definition the spirit a drink is built on, so there is no other shelf it could be
 * on, and leaving them ungrouped would strand exactly the ticks that unlock the most
 * drinks.
 */
export const STOCK_GROUPS: readonly { category: Category; label: string; items: string[] }[] =
  CATEGORY_ORDER.filter((c) => !NON_STOCKABLE.has(c))
    .map((category) => ({
      category,
      label: SHELF_LABELS[category],
      items: STOCKABLE.filter((i) => (categoryOf(i) ?? 'liquor') === category),
    }))
    .filter((g) => g.items.length > 0);

// ---- Make-a-Drink: the interactive walk ------------------------------------

export interface WalkState {
  /** The chosen base spirit. Nothing is reachable before one is picked. */
  base: string | null;
  /** Ingredients chosen so far, in order. */
  picked: readonly string[];
  /** Categories the guest declined, so recipes needing them are out. */
  skipped: readonly Category[];
}

/**
 * Recipes still in play: right base, contains everything picked, and needs nothing
 * from a category that was declined.
 *
 * A port of the legacy `reachable()`, behaviour-for-behaviour — including the
 * subtlety that an ingredient already picked survives its category being skipped,
 * which is what lets the walk offer "anything else from this category?" and take no
 * for an answer without discarding the yes it already has.
 */
export function reachable(state: WalkState): Recipe[] {
  const { base, picked, skipped } = state;
  if (!base) return [];
  const skippedSet = new Set(skipped);
  const pickedSet = new Set(picked);
  return RECIPES.filter((r) => {
    if (r.base !== base) return false;
    if (!picked.every((p) => r.ingredients.includes(p))) return false;
    return !r.ingredients.some((i) => {
      const cat = categoryOf(i);
      return cat !== undefined && skippedSet.has(cat) && !pickedSet.has(i);
    });
  });
}

/** A recipe whose ingredient set is exactly what's been picked — the walk is done. */
export function exactMatch(recipes: readonly Recipe[], picked: readonly string[]): Recipe | null {
  return recipes.find((r) => r.ingredients.length === picked.length) ?? null;
}

/** How many of these recipes would survive adding one more ingredient. */
export const countWith = (recipes: readonly Recipe[], ingredient: string): number =>
  recipes.filter((r) => r.ingredients.includes(ingredient)).length;

// ---- The host's cupboard ---------------------------------------------------

export interface MakeableOptions {
  /**
   * Categories to treat as always available. `method` is always ignored; adding
   * `finish` is the usual second choice, because a missing olive shouldn't hide a
   * Martini — but that's a product decision, so it's a parameter rather than a
   * hardcoded kindness.
   */
  ignore?: readonly Category[];
}

/**
 * The product decision about garnishes, made once.
 *
 * A missing olive shouldn't hide a Martini, and asking a host to tick fourteen
 * garnishes before their menu behaves would make the stock screen a chore rather
 * than a minute's work.
 *
 * It lives here rather than in either endpoint because it was briefly in **both**,
 * and they didn't agree: `/api/inventory` passed nothing while `/api/events/[id]/menu`
 * passed `['finish']`, so the host's screen and the guest menu were counting
 * different drinks. That is precisely the drift both endpoints compute server-side
 * to avoid — a rule written twice is a rule that will differ, which is the same
 * reason the permission table has one home.
 */
export const OPTIONAL_CATEGORIES: readonly Category[] = ['finish'];

/**
 * What tonight's stock can actually produce.
 *
 * The base must be in stock — it's the whole drink — and so must every ingredient
 * whose category isn't being ignored.
 */
export function makeable(stock: Iterable<string>, options: MakeableOptions = {}): Recipe[] {
  const have = new Set(stock);
  const ignored = new Set<Category>([...NON_STOCKABLE, ...(options.ignore ?? [])]);
  return RECIPES.filter((r) => {
    if (!have.has(r.base)) return false;
    return r.ingredients.every((i) => {
      const cat = categoryOf(i);
      if (cat !== undefined && ignored.has(cat)) return true;
      return have.has(i);
    });
  });
}

/**
 * Can tonight's stock pour each of these, by name?
 *
 * This is what gates the guest menu. The curated drinks and the catalogue recipes are
 * separate lists that happen to overlap: four of the six match by name, and
 * **Pom & Elderflower and the legacy generic Wine card have no recipe at all**.
 *
 * A drink we know nothing about is reported **available**. Hiding it would mean
 * telling a guest with an untouched cupboard that the old house fallback is already
 * unavailable. Recorded cupboards use the specific Red, White and Rosé Wine recipes;
 * this permissive path is only for legacy cards the catalogue cannot reason about.
 * Absence of knowledge is not evidence of absence, and the failure modes are not
 * symmetric: wrongly offering a drink costs someone a "sorry, we're out"; wrongly
 * hiding one costs a drink nobody knew they could have had.
 */
export function availability(
  stock: Iterable<string>,
  names: readonly string[],
  options: MakeableOptions = {},
): Record<string, boolean> {
  const can = new Set(makeable(stock, options).map((r) => r.name.toLowerCase()));
  const known = new Set(RECIPES.map((r) => r.name.toLowerCase()));
  const out: Record<string, boolean> = {};
  for (const name of names) {
    const key = name.toLowerCase();
    out[name] = known.has(key) ? can.has(key) : true;
  }
  return out;
}

/**
 * What one more bottle would unlock, best first.
 *
 * The useful question a stock screen can answer that a list of ticks cannot: not
 * "what can I make" but "what should I buy". Only counts ingredients that are
 * currently the *sole* thing standing between the stock and a recipe.
 */
export function suggestions(
  stock: Iterable<string>,
  options: MakeableOptions = {},
): { ingredient: string; unlocks: number }[] {
  const have = new Set(stock);
  const ignored = new Set<Category>([...NON_STOCKABLE, ...(options.ignore ?? [])]);
  const counts = new Map<string, number>();

  for (const r of RECIPES) {
    const missing: string[] = [];
    if (!have.has(r.base)) missing.push(r.base);
    for (const i of r.ingredients) {
      const cat = categoryOf(i);
      if (cat !== undefined && ignored.has(cat)) continue;
      if (!have.has(i)) missing.push(i);
    }
    if (missing.length === 1) {
      const only = missing[0]!;
      counts.set(only, (counts.get(only) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([ingredient, unlocks]) => ({ ingredient, unlocks }))
    .sort((a, b) => b.unlocks - a.unlocks || a.ingredient.localeCompare(b.ingredient));
}
