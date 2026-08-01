import { DRINKS, axesFor, buildLine, type BuiltLine, type Config, type Drink } from '$lib/data';
import type { RecipeGuide } from './orders';
import { categoryOf, RECIPES, type Recipe } from './recipes';

const catalogueGuide = (recipe: Recipe): RecipeGuide => ({
  ingredients: recipe.spec
    ? recipe.spec.measures.map(({ ingredient, amount }) => ({ name: ingredient, amount }))
    : [
        { name: recipe.base },
        ...recipe.ingredients
          .filter((ingredient) => categoryOf(ingredient) !== 'method')
          .map((name) => ({ name })),
      ],
  steps: recipe.spec?.steps ?? [],
  method: recipe.method,
  ice: recipe.ice,
  glass: recipe.glass,
  garnish: recipe.garnish,
});

/** Every exact label and ingredient list the configurator can produce. */
export function configuredLines(drink: Drink): Map<string, BuiltLine> {
  const lines = new Map<string, BuiltLine>();
  const axes = axesFor(drink);

  const visit = (index: number, config: Config): void => {
    if (index === axes.length) {
      const line = buildLine(drink, config);
      if (!lines.has(line.name)) lines.set(line.name, line);
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
  const first = lines.values().next().value;
  if (first) lines.set(drink.name, { ...first, name: drink.name });
  return lines;
}

/** Resolve a validated order label to the instructions the bar should see. */
export function recipeGuideForOrderLine(name: string): RecipeGuide | undefined {
  const exact = RECIPES.find((recipe) => recipe.name === name);
  if (exact) return catalogueGuide(exact);

  for (const drink of DRINKS) {
    const line = configuredLines(drink).get(name);
    if (!line) continue;
    const base = RECIPES.find((recipe) => recipe.name === drink.name);
    return {
      ingredients: line.recipe.map((ingredient) => ({ name: ingredient })),
      steps: base?.spec?.steps ?? [],
      method: base?.method,
      ice: base?.ice,
      glass: base?.glass,
      garnish: base?.garnish,
    };
  }
  return undefined;
}
