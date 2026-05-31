/**
 * The menu, ported from the legacy app: a flat list of DRINKS, each composed
 * from reusable option AXES. The first axis on a spirit drink is Boozy/Boring.
 * This is the single source of truth for the menu + configurator.
 */

export interface Choice {
  value: string;
  label: string;
  emoji?: string;
  tag?: string;
  adds?: string[];
}

export interface Axis {
  key: string;
  label: string;
  choices: Choice[];
  showIf?: (c: Config) => boolean;
}

export type Config = Record<string, string>;

export interface Drink {
  name: string;
  emoji: string;
  spirits: string[];
  baseIngredients: string[];
  axes: Axis[];
  /** false = always boozy (no Boozy/Boring axis), e.g. Old Fashioned. */
  boozeChoice?: boolean;
}

// ---- reusable axes ----
const BOOZE_OPT: Axis = {
  key: 'booze',
  label: 'Make it',
  choices: [
    { value: 'Boozy', label: 'Boozy', emoji: '🥃' },
    { value: 'Boring', label: 'Boring', emoji: '🌱', tag: 'Boring' },
  ],
};

const STRENGTH_OPT: Axis = {
  key: 'strength',
  label: 'Strength',
  showIf: (c) => c.booze !== 'Boring',
  choices: [
    { value: 'Single', label: 'Single', tag: 'Single' },
    { value: 'Double', label: 'Double', tag: 'Double', adds: ['Extra shot'] },
  ],
};

const SERVE_OPT: Axis = {
  key: 'serve',
  label: 'Serve',
  choices: [
    { value: 'Short', label: 'Short', emoji: '🥃', tag: 'Short', adds: ['Tumbler'] },
    { value: 'Long', label: 'Long', emoji: '🥤', tag: 'Long', adds: ['Highball glass'] },
  ],
};

const ICE_OPT: Axis = {
  key: 'ice',
  label: 'Ice',
  choices: [
    { value: 'Cubes', label: 'Cubes', emoji: '🧊' },
    { value: 'Crushed', label: 'Crushed', emoji: '❄️', tag: 'Crushed ice' },
    { value: 'None', label: 'None', emoji: '🚫', tag: 'No ice' },
  ],
};

const GARNISH_OPT: Axis = {
  key: 'garnish',
  label: 'Garnish',
  choices: [
    { value: 'Yes', label: 'Yes', emoji: '🌿' },
    { value: 'No', label: 'No', emoji: '🚫', tag: 'No garnish' },
  ],
};

const MARGBASE_OPT: Axis = {
  key: 'base',
  label: 'Flavour',
  choices: [
    { value: 'Classic', label: 'Classic' },
    { value: 'Watermelon', label: 'Watermelon', emoji: '🍉', tag: 'Watermelon', adds: ['Watermelon'] },
  ],
};

const SPICE_OPT: Axis = {
  key: 'spicy',
  label: 'Spice',
  choices: [
    { value: 'No', label: 'No' },
    { value: 'Spicy', label: 'Spicy', emoji: '🌶️', tag: 'Spicy', adds: ['Fresh Chili'] },
  ],
};

const WINE_COLOUR_OPT: Axis = {
  key: 'colour',
  label: 'Colour',
  choices: [
    { value: 'White', label: 'White', emoji: '🤍', tag: 'White' },
    { value: 'Red', label: 'Red', emoji: '❤️', tag: 'Red' },
    { value: 'Rosé', label: 'Rosé', emoji: '🩷', tag: 'Rosé' },
  ],
};

const WINE_ICE_OPT: Axis = {
  key: 'ice',
  label: 'Ice',
  showIf: (c) => c.colour === 'White' || c.colour === 'Rosé',
  choices: [
    { value: '1 cube', label: '1 cube', emoji: '🧊', tag: '1 cube', adds: ['1 ice cube'] },
    { value: '2 cubes', label: '2 cubes', emoji: '🧊', tag: '2 cubes', adds: ['2 ice cubes'] },
  ],
};

export const DRINKS: Drink[] = [
  {
    name: 'Margarita',
    emoji: '🍹',
    spirits: ['Tequila', 'Triple Sec / Cointreau'],
    baseIngredients: ['Lime', 'Agave', 'Salt rim', 'Crushed Ice'],
    axes: [MARGBASE_OPT, SPICE_OPT, STRENGTH_OPT, GARNISH_OPT],
  },
  {
    name: 'Mojito',
    emoji: '🌿',
    spirits: ['White Rum'],
    baseIngredients: ['Fresh Mint', 'Lime', 'Sugar', 'Soda Water', 'Crushed Ice'],
    axes: [STRENGTH_OPT, GARNISH_OPT, SERVE_OPT],
  },
  {
    name: 'Moscow Mule',
    emoji: '🫚',
    spirits: ['Vodka'],
    baseIngredients: ['Lime', 'Ginger Beer', 'Fresh Ginger', 'Cubes'],
    axes: [STRENGTH_OPT, ICE_OPT, SERVE_OPT],
  },
  {
    name: 'Old Fashioned',
    emoji: '🥃',
    boozeChoice: false,
    spirits: ['Bourbon / Rye Whiskey'],
    baseIngredients: ['Sugar Cube', 'Angostura Bitters', 'Orange Peel', 'Large Ice Cube'],
    axes: [STRENGTH_OPT],
  },
  {
    name: 'Pom & Elderflower',
    emoji: '🌸',
    spirits: ['Prosecco'],
    baseIngredients: ['Pomegranate Juice', 'Elderflower Cordial', 'Lime', 'Soda Water'],
    axes: [ICE_OPT, GARNISH_OPT],
  },
  {
    name: 'Wine',
    emoji: '🍷',
    boozeChoice: false,
    spirits: [],
    baseIngredients: ['House wine'],
    axes: [WINE_COLOUR_OPT, WINE_ICE_OPT],
  },
];

/** Full ordered axis list for a drink (prepends Boozy/Boring when relevant). */
export function axesFor(drink: Drink): Axis[] {
  const lead = drink.spirits.length > 0 && drink.boozeChoice !== false ? [BOOZE_OPT] : [];
  return [...lead, ...drink.axes];
}

export function visibleAxes(drink: Drink, config: Config): Axis[] {
  return axesFor(drink).filter((a) => !a.showIf || a.showIf(config));
}

export function defaultConfig(drink: Drink): Config {
  const config: Config = {};
  for (const axis of axesFor(drink)) {
    if (!axis.showIf || axis.showIf(config)) config[axis.key] = axis.choices[0]!.value;
  }
  return config;
}

export interface BuiltLine {
  /** order-line label, e.g. "Margarita — Spicy, Double" */
  name: string;
  recipe: string[];
  boozy: boolean;
}

export function buildLine(drink: Drink, config: Config): BuiltLine {
  const tags: string[] = [];
  const adds: string[] = [];
  for (const axis of visibleAxes(drink, config)) {
    const choice = axis.choices.find((c) => c.value === config[axis.key]);
    if (!choice) continue;
    if (choice.tag) tags.push(choice.tag);
    if (choice.adds) adds.push(...choice.adds);
  }
  const boozy = drink.boozeChoice === false ? true : config.booze !== 'Boring';
  const recipe = [...(boozy ? drink.spirits : []), ...drink.baseIngredients, ...adds];
  const name = tags.length ? `${drink.name} — ${tags.join(', ')}` : drink.name;
  return { name, recipe, boozy };
}
