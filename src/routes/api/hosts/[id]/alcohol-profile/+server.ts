import { json, type RequestEvent } from '@sveltejs/kit';
import {
  ALCOHOL_PROFILES,
  OPTIONAL_CATEGORIES,
  RECIPES,
  host,
  makeable,
  snapshotForRecipe,
  type AlcoholOverrides,
} from '$lib/shared';
import { listAlcoholOverrides, listStock, setAlcoholOverrides, userById } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

const view = (userId: string) => {
  const overrides = listAlcoholOverrides(userId);
  const stockRows = listStock(userId);
  const stockedIngredients = stockRows.filter((row) => row.inStock).map((row) => row.ingredient);
  const makeableIds = new Set(
    makeable(stockedIngredients, { ignore: OPTIONAL_CATEGORIES }).map((recipe) => recipe.id),
  );
  return {
    overrides,
    ingredients: Object.entries(ALCOHOL_PROFILES).map(([ingredient, profile]) => ({
      ingredient,
      defaultAbv: profile.abv,
      source: profile.source,
      inStock: stockRows.some((row) => row.ingredient === ingredient && row.inStock),
    })),
    recipes: RECIPES.map((recipe) => {
      const snapshot = snapshotForRecipe(recipe);
      return {
        id: recipe.id,
        name: recipe.name,
        makeable: makeableIds.has(recipe.id),
        components: snapshot.components.map((component) => ({
          ingredient: component.ingredient,
          defaultVolumeMl: component.volumeMl,
        })),
      };
    }).filter((recipe) => recipe.components.length > 0),
  };
};

export async function GET(event: RequestEvent) {
  const userId = event.params.id!;
  const auth = await requireCapability(event, 'stock:read', host(userId));
  if (denied(auth)) return auth.denied;
  if (!userById(userId)) return fail(404, 'no such host');
  return json({ ok: true, ...view(userId) });
}

/** Full replacement: omission is the explicit reset-to-catalogue operation. */
export async function PUT(event: RequestEvent) {
  const userId = event.params.id!;
  const auth = await requireCapability(event, 'stock:edit', host(userId));
  if (denied(auth)) return auth.denied;
  if (!userById(userId)) return fail(404, 'no such host');

  const input = await body(event);
  if (!input.abv || typeof input.abv !== 'object' || Array.isArray(input.abv)) {
    return fail(422, 'abv must be an object');
  }
  if (!input.volumes || typeof input.volumes !== 'object' || Array.isArray(input.volumes)) {
    return fail(422, 'volumes must be an object');
  }

  const stocked = new Set(listStock(userId).map((row) => row.ingredient));
  const abv: Record<string, number> = {};
  for (const [ingredient, value] of Object.entries(input.abv as Record<string, unknown>)) {
    if (!(ingredient in ALCOHOL_PROFILES) || !stocked.has(ingredient)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
      return fail(422, `invalid ABV for ${ingredient}`);
    }
    abv[ingredient] = value;
  }

  const recipes = new Map(RECIPES.map((recipe) => [recipe.id, snapshotForRecipe(recipe)]));
  const volumes: Record<string, Record<string, number>> = {};
  for (const [recipeId, raw] of Object.entries(input.volumes as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const recipe = recipes.get(recipeId);
    if (!recipe) continue;
    const allowed = new Set(recipe.components.map((component) => component.ingredient));
    const kept: Record<string, number> = {};
    for (const [ingredient, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!allowed.has(ingredient)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 2000) {
        return fail(422, `invalid pour for ${ingredient}`);
      }
      kept[ingredient] = value;
    }
    if (Object.keys(kept).length > 0) volumes[recipeId] = kept;
  }

  const overrides: AlcoholOverrides = { abv, volumes };
  setAlcoholOverrides(userId, overrides);
  return json({ ok: true, ...view(userId) });
}
