import { DRINKS } from '$lib/data';
import { RECIPES, type Recipe } from './recipes';
import type { OrderItem } from './orders';
import { configuredLines } from './recipe-guide';

/** Increment when a default pour or strength changes. Stored orders keep their version. */
export const ALCOHOL_CATALOG_VERSION = 1;

export type UnitBasis =
  'verified-default' | 'host-override' | 'reconstructed' | 'alcohol-free' | 'unknown';

export interface AlcoholComponentSnapshot {
  ingredient: string;
  volumeMl: number;
  abv: number;
  units: number;
  volumeSource: 'recipe' | 'house-default' | 'host-override';
  abvSource: 'catalogue' | 'host-override';
}

export interface UnitSnapshot {
  recipeId: string | null;
  unitsPerServing: number | null;
  basis: UnitBasis;
  components: AlcoholComponentSnapshot[];
  catalogVersion: number;
  calculatedAt: number;
  source: { label: string; url?: string; reviewedAt: string };
}

/** The database-only extension of an order line; ordinary queue responses strip it. */
export interface StoredOrderItem extends OrderItem {
  unit?: UnitSnapshot;
}

export interface AlcoholOverrides {
  abv: Readonly<Record<string, number>>;
  volumes: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export const NO_ALCOHOL_OVERRIDES: AlcoholOverrides = { abv: {}, volumes: {} };

export interface AlcoholProfile {
  abv: number;
  source: string;
}

/**
 * House strengths for generic stock names.
 *
 * These are estimates, not claims about a particular bottle. The host can replace
 * any of them with the number printed on what they actually bought. Values use the
 * common UK bottling for a named product and a conservative house value for broad
 * families such as amaro and fruit liqueur.
 */
export const ALCOHOL_PROFILES: Readonly<Record<string, AlcoholProfile>> = {
  Absinthe: { abv: 60, source: 'House absinthe strength' },
  'Aged Rum': { abv: 40, source: 'House spirit strength' },
  'Allspice Dram': { abv: 22.5, source: 'House liqueur strength' },
  Amaretto: { abv: 28, source: 'House amaretto strength' },
  Amaro: { abv: 24, source: 'House amaro strength' },
  Aperitivo: { abv: 15, source: 'House aperitivo strength' },
  Aperol: { abv: 11, source: 'Aperol UK bottling' },
  'Apple Brandy': { abv: 40, source: 'House spirit strength' },
  'Apple Liqueur': { abv: 20, source: 'House liqueur strength' },
  'Apricot Brandy': { abv: 25, source: 'House liqueur strength' },
  'Apricot Liqueur': { abv: 25, source: 'House liqueur strength' },
  Aquavit: { abv: 40, source: 'House spirit strength' },
  'Bianco Vermouth': { abv: 15, source: 'House vermouth strength' },
  'Blue Curaçao': { abv: 20, source: 'House curaçao strength' },
  Bourbon: { abv: 40, source: 'House spirit strength' },
  Brandy: { abv: 40, source: 'House spirit strength' },
  Bénédictine: { abv: 40, source: 'Bénédictine DOM bottling' },
  Cachaça: { abv: 40, source: 'House spirit strength' },
  Campari: { abv: 25, source: 'Campari UK bottling' },
  Chambord: { abv: 16.5, source: 'Chambord bottling' },
  Champagne: { abv: 12, source: 'House sparkling-wine strength' },
  'Cherry Heering': { abv: 24, source: 'Cherry Heering bottling' },
  'Coffee Liqueur': { abv: 20, source: 'House coffee-liqueur strength' },
  Cognac: { abv: 40, source: 'House spirit strength' },
  'Crème de Banane': { abv: 25, source: 'House liqueur strength' },
  'Crème de Cacao': { abv: 25, source: 'House liqueur strength' },
  'Crème de Cassis': { abv: 15, source: 'House liqueur strength' },
  'Crème de Menthe': { abv: 25, source: 'House liqueur strength' },
  'Crème de Mûre': { abv: 20, source: 'House liqueur strength' },
  'Crème de Noyaux': { abv: 20, source: 'House liqueur strength' },
  'Crème de Violette': { abv: 20, source: 'House liqueur strength' },
  Cynar: { abv: 16.5, source: 'Cynar bottling' },
  Drambuie: { abv: 40, source: 'Drambuie bottling' },
  'Dry Curaçao': { abv: 40, source: 'House dry-curaçao strength' },
  'Dry Sherry': { abv: 17.5, source: 'House sherry strength' },
  'Dry Vermouth': { abv: 18, source: 'House vermouth strength' },
  'Elderflower Liqueur': { abv: 20, source: 'House elderflower-liqueur strength' },
  Falernum: { abv: 11, source: 'House falernum strength' },
  Fernet: { abv: 39, source: 'House fernet strength' },
  Galliano: { abv: 42.3, source: 'Galliano L’Autentico bottling' },
  Genever: { abv: 35, source: 'House genever strength' },
  Gin: { abv: 40, source: 'House spirit strength' },
  'Ginger Wine': { abv: 13.5, source: 'House ginger-wine strength' },
  'Grand Marnier': { abv: 40, source: 'Grand Marnier Cordon Rouge bottling' },
  'Green Chartreuse': { abv: 55, source: 'Green Chartreuse bottling' },
  'Irish Cream': { abv: 17, source: 'House Irish-cream strength' },
  'Irish Whiskey': { abv: 40, source: 'House spirit strength' },
  'Light Rum': { abv: 40, source: 'House spirit strength' },
  'Lillet Blanc': { abv: 17, source: 'Lillet Blanc bottling' },
  Limoncello: { abv: 27, source: 'House limoncello strength' },
  'Maraschino Liqueur': { abv: 32, source: 'House maraschino strength' },
  'Melon Liqueur': { abv: 20, source: 'House melon-liqueur strength' },
  Mezcal: { abv: 40, source: 'House spirit strength' },
  'Orange Curaçao': { abv: 30, source: 'House curaçao strength' },
  Pastis: { abv: 45, source: 'House pastis strength' },
  'Peach Schnapps': { abv: 20, source: 'House schnapps strength' },
  Pisco: { abv: 40, source: 'House spirit strength' },
  "Pimm's": { abv: 25, source: 'Pimm’s No. 1 bottling' },
  Port: { abv: 20, source: 'House port strength' },
  Prosecco: { abv: 11, source: 'House prosecco strength' },
  'Red Wine': { abv: 12, source: 'NHS standard wine example' },
  Rye: { abv: 40, source: 'House spirit strength' },
  Sake: { abv: 15, source: 'House sake strength' },
  Scotch: { abv: 40, source: 'House spirit strength' },
  'Select Aperitivo': { abv: 17.5, source: 'Select Aperitivo bottling' },
  Sherry: { abv: 17.5, source: 'House sherry strength' },
  'Sloe Gin': { abv: 26, source: 'House sloe-gin strength' },
  Stout: { abv: 4.2, source: 'House stout strength' },
  Suze: { abv: 20, source: 'Suze bottling' },
  'Sweet Vermouth': { abv: 16, source: 'House vermouth strength' },
  'Tawny Port': { abv: 20, source: 'House port strength' },
  Tequila: { abv: 40, source: 'House spirit strength' },
  'Triple Sec': { abv: 30, source: 'House triple-sec strength' },
  Vodka: { abv: 40, source: 'House spirit strength' },
  'Vanilla Vodka': { abv: 37.5, source: 'House flavoured-vodka strength' },
  'White Rum': { abv: 40, source: 'House spirit strength' },
  'White Wine': { abv: 12, source: 'NHS standard wine example' },
  'Yellow Chartreuse': { abv: 43, source: 'Yellow Chartreuse bottling' },
  'Rosé Wine': { abv: 12, source: 'NHS standard wine example' },
  'Angostura Bitters': { abv: 44.7, source: 'Angostura Aromatic Bitters bottling' },
  'Orange Bitters': { abv: 28, source: 'House orange-bitters strength' },
  "Peychaud's Bitters": { abv: 35, source: 'Peychaud’s Aromatic Bitters bottling' },
  'Chocolate Bitters': { abv: 40, source: 'House cocktail-bitters strength' },
  'Mole Bitters': { abv: 40, source: 'House cocktail-bitters strength' },
  'Cardamom Bitters': { abv: 40, source: 'House cocktail-bitters strength' },
  'Celery Bitters': { abv: 40, source: 'House cocktail-bitters strength' },
  'Grapefruit Bitters': { abv: 40, source: 'House cocktail-bitters strength' },
};

const REVIEWED_AT = '2026-08-01';
const HOUSE_SOURCE = {
  label: 'House standard specification',
  url: 'https://www.nhs.uk/live-well/alcohol-advice/calculating-alcohol-units/',
  reviewedAt: REVIEWED_AT,
};

const BUBBLES = new Set(['Champagne', 'Prosecco']);
const WINES = new Set(['Red Wine', 'White Wine', 'Rosé Wine']);
const FORTIFIED = new Set([
  'Bianco Vermouth',
  'Dry Sherry',
  'Dry Vermouth',
  'Ginger Wine',
  'Lillet Blanc',
  'Port',
  'Sake',
  'Sherry',
  'Sweet Vermouth',
  'Tawny Port',
]);

const mlFromAmount = (amount: string): number | null => {
  const match = amount.trim().match(/^(\d+(?:\.\d+)?)\s*ml$/i);
  return match ? Number(match[1]) : null;
};

export const isAlcoholicIngredient = (ingredient: string): boolean =>
  (ALCOHOL_PROFILES[ingredient]?.abv ?? 0) > 0;

function defaultVolume(recipe: Recipe, ingredient: string, secondaryCount: number): number {
  const isBase = ingredient === recipe.base;
  if (WINES.has(ingredient)) return isBase ? 175 : 75;
  if (BUBBLES.has(ingredient)) return isBase ? 125 : 75;
  if (ingredient === 'Stout') return isBase ? 330 : 90;
  if (ingredient.includes('Bitters')) return 2;
  if (ingredient === 'Absinthe') return isBase ? 30 : 5;
  if (FORTIFIED.has(ingredient)) return isBase ? 75 : 20;
  if (isBase && recipe.base === 'Aperitivo') return 60;
  if (isBase) return 50;
  return secondaryCount >= 3 ? 15 : 20;
}

function recipeSource(recipe: Recipe): UnitSnapshot['source'] {
  return recipe.spec?.source
    ? {
        ...recipe.spec.source,
        url: recipe.spec.source.url ?? HOUSE_SOURCE.url,
        reviewedAt: recipe.spec.source.reviewedAt ?? REVIEWED_AT,
      }
    : HOUSE_SOURCE;
}

function recipeComponents(recipe: Recipe, overrides: AlcoholOverrides): AlcoholComponentSnapshot[] {
  const names = [recipe.base, ...recipe.ingredients].filter(isAlcoholicIngredient);
  const unique = [...new Set(names)];
  const secondaryCount = unique.filter((ingredient) => ingredient !== recipe.base).length;
  const explicit = new Map(
    (recipe.spec?.measures ?? []).flatMap(({ ingredient, amount }) => {
      const ml = mlFromAmount(amount);
      return ml === null ? [] : ([[ingredient, ml]] as const);
    }),
  );

  return unique.map((ingredient) => {
    const volumeOverride = overrides.volumes[recipe.id]?.[ingredient];
    const abvOverride = overrides.abv[ingredient];
    const volumeMl =
      volumeOverride ??
      explicit.get(ingredient) ??
      defaultVolume(recipe, ingredient, secondaryCount);
    const abv = abvOverride ?? ALCOHOL_PROFILES[ingredient]!.abv;
    return {
      ingredient,
      volumeMl,
      abv,
      units: (volumeMl * abv) / 1000,
      volumeSource:
        volumeOverride !== undefined
          ? 'host-override'
          : explicit.has(ingredient)
            ? 'recipe'
            : 'house-default',
      abvSource: abvOverride !== undefined ? 'host-override' : 'catalogue',
    };
  });
}

export function snapshotForRecipe(
  recipe: Recipe,
  overrides: AlcoholOverrides = NO_ALCOHOL_OVERRIDES,
  requestedBasis: 'verified-default' | 'reconstructed' = 'verified-default',
  calculatedAt = Date.now(),
): UnitSnapshot {
  const components = recipeComponents(recipe, overrides);
  const overridden = components.some(
    (component) =>
      component.volumeSource === 'host-override' || component.abvSource === 'host-override',
  );
  return {
    recipeId: recipe.id,
    unitsPerServing: components.reduce((total, component) => total + component.units, 0),
    basis: components.length === 0 ? 'alcohol-free' : overridden ? 'host-override' : requestedBasis,
    components,
    catalogVersion: ALCOHOL_CATALOG_VERSION,
    calculatedAt,
    source: recipeSource(recipe),
  };
}

function configuredRecipe(name: string): { recipe: Recipe; multiplier: number } | null {
  if (name === 'Wine' || name.startsWith('Wine —')) {
    const wine = name.includes('White')
      ? 'White Wine'
      : name.includes('Rosé')
        ? 'Rosé Wine'
        : 'Red Wine';
    return { recipe: RECIPES.find((candidate) => candidate.name === wine)!, multiplier: 1 };
  }
  if (name === 'Nojito') {
    return {
      recipe: RECIPES.find((candidate) => candidate.name === 'Virgin Mojito')!,
      multiplier: 1,
    };
  }
  for (const drink of DRINKS) {
    if (name !== drink.name && !name.startsWith(`${drink.name} —`)) continue;
    if (name.includes('Boring')) {
      const alcoholFree = RECIPES.find((candidate) => candidate.name === 'Virgin Mojito');
      if (alcoholFree) return { recipe: alcoholFree, multiplier: 1 };
    }
    const recipe = RECIPES.find((candidate) => candidate.name === drink.name);
    if (recipe) return { recipe, multiplier: name.includes('Double') ? 2 : 1 };
  }
  return null;
}

export function snapshotForOrderLine(
  name: string,
  overrides: AlcoholOverrides = NO_ALCOHOL_OVERRIDES,
  requestedBasis: 'verified-default' | 'reconstructed' = 'verified-default',
  calculatedAt = Date.now(),
): UnitSnapshot {
  const exact = RECIPES.find((recipe) => recipe.name.toLowerCase() === name.toLowerCase());
  const configuredLine = DRINKS.map((drink) => ({
    drink,
    line: configuredLines(drink).get(name),
  })).find((candidate) => candidate.line);
  if (configuredLine?.line && !configuredLine.line.boozy) {
    return {
      recipeId: `configured-${configuredLine.drink.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      unitsPerServing: 0,
      basis: 'alcohol-free',
      components: [],
      catalogVersion: ALCOHOL_CATALOG_VERSION,
      calculatedAt,
      source: HOUSE_SOURCE,
    };
  }
  const configured = exact ? { recipe: exact, multiplier: 1 } : configuredRecipe(name);
  if (!configured) {
    if (name === 'Pom & Elderflower') {
      const volumeMl = overrides.volumes['legacy-pom-elderflower']?.Prosecco ?? 100;
      const abv = overrides.abv.Prosecco ?? ALCOHOL_PROFILES.Prosecco!.abv;
      return {
        recipeId: 'legacy-pom-elderflower',
        unitsPerServing: (volumeMl * abv) / 1000,
        basis:
          requestedBasis === 'reconstructed'
            ? 'reconstructed'
            : overrides.abv.Prosecco !== undefined ||
                overrides.volumes['legacy-pom-elderflower']?.Prosecco !== undefined
              ? 'host-override'
              : 'verified-default',
        components: [
          {
            ingredient: 'Prosecco',
            volumeMl,
            abv,
            units: (volumeMl * abv) / 1000,
            volumeSource:
              overrides.volumes['legacy-pom-elderflower']?.Prosecco !== undefined
                ? 'host-override'
                : 'house-default',
            abvSource: overrides.abv.Prosecco !== undefined ? 'host-override' : 'catalogue',
          },
        ],
        catalogVersion: ALCOHOL_CATALOG_VERSION,
        calculatedAt,
        source: HOUSE_SOURCE,
      };
    }
    return {
      recipeId: null,
      unitsPerServing: null,
      basis: 'unknown',
      components: [],
      catalogVersion: ALCOHOL_CATALOG_VERSION,
      calculatedAt,
      source: HOUSE_SOURCE,
    };
  }

  const snapshot = snapshotForRecipe(configured.recipe, overrides, requestedBasis, calculatedAt);
  if (configured.multiplier === 1 || snapshot.unitsPerServing === null) return snapshot;
  const components = snapshot.components.map((component) =>
    component.ingredient === configured.recipe.base
      ? {
          ...component,
          volumeMl: component.volumeMl * configured.multiplier,
          units: component.units * configured.multiplier,
        }
      : component,
  );
  return {
    ...snapshot,
    components,
    unitsPerServing: components.reduce((total, component) => total + component.units, 0),
  };
}

/** Complete means every catalogue recipe resolves to an exact numeric answer. */
export function alcoholCatalogueProblems(): string[] {
  const problems: string[] = [];
  for (const recipe of RECIPES) {
    const snapshot = snapshotForRecipe(recipe, NO_ALCOHOL_OVERRIDES, 'verified-default', 0);
    if (snapshot.unitsPerServing === null || !Number.isFinite(snapshot.unitsPerServing)) {
      problems.push(`${recipe.name}: no unit estimate`);
    }
    for (const component of snapshot.components) {
      if (component.volumeMl <= 0 || component.abv <= 0 || component.abv > 100) {
        problems.push(`${recipe.name}: invalid ${component.ingredient} profile`);
      }
    }
  }
  return problems;
}
