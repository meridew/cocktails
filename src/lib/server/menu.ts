import { DRINKS, axesFor, buildLine, type Config, type Drink } from '$lib/data';
import { makeable, OPTIONAL_CATEGORIES, type RECIPES } from '$lib/shared';
import { listEventMenu, listStock, type EventRow } from './db';

export interface GeneratedMenuItem {
  id: string;
  name: string;
  base: string;
  blurb?: string;
  glass?: string;
  garnish?: string;
}

/** Build the one menu used by both the public response and order validation. */
export function generatedMenu(found: Pick<EventRow, 'id' | 'hostUserId'>): {
  source: 'cupboard' | 'house';
  recorded: boolean;
  stock: string[];
  items: GeneratedMenuItem[];
  shortList: string[];
} {
  const rows = listStock(found.hostUserId);
  const stock = rows.filter((row) => row.inStock).map((row) => row.ingredient);
  const recorded = rows.length > 0;
  const items: GeneratedMenuItem[] = recorded
    ? makeable(stock, { ignore: OPTIONAL_CATEGORIES }).map(describeRecipe)
    : DRINKS.map((drink) => ({
        id: drink.name,
        name: drink.name,
        base: drink.spirits[0] ?? '',
      }));
  const shortList = listEventMenu(found.id).filter((id) => items.some((item) => item.id === id));
  return { source: recorded ? 'cupboard' : 'house', recorded, stock, items, shortList };
}

const describeRecipe = (recipe: (typeof RECIPES)[number]): GeneratedMenuItem => ({
  id: recipe.id,
  name: recipe.name,
  base: recipe.base,
  blurb: recipe.blurb,
  glass: recipe.glass,
  garnish: recipe.garnish,
});

/** Every valid label the configurator can produce for one of the house drinks. */
function configuredNames(drink: Drink): Set<string> {
  const names = new Set<string>([drink.name]);
  const axes = axesFor(drink);

  const visit = (index: number, config: Config): void => {
    if (index === axes.length) {
      names.add(buildLine(drink, config).name);
      return;
    }
    const axis = axes[index]!;
    if (axis.showIf && !axis.showIf(config)) {
      visit(index + 1, config);
      return;
    }
    for (const choice of axis.choices) {
      visit(index + 1, { ...config, [axis.key]: choice.value });
    }
  };

  visit(0, {});
  return names;
}

/** Order-line names the guest-facing menu currently permits at this party. */
export function offeredOrderNames(found: Pick<EventRow, 'id' | 'hostUserId'>): Set<string> {
  const menu = generatedMenu(found);
  const featured = new Set(menu.shortList);
  const items = featured.size ? menu.items.filter((item) => featured.has(item.id)) : menu.items;
  const names = new Set(items.map((item) => item.name));

  for (const item of items) {
    const configurable = DRINKS.find((drink) => drink.name === item.name);
    if (configurable) for (const name of configuredNames(configurable)) names.add(name);
  }
  return names;
}
