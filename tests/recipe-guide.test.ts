import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { buildLine, DRINKS } from '$lib/data';
import { RECIPES, recipeGuideForOrderLine } from '$lib/shared';

describe('bartender recipe guides', () => {
  test('every catalogue drink has composition and serve instructions', () => {
    for (const recipe of RECIPES) {
      const guide = recipeGuideForOrderLine(recipe.name);
      assert.ok(guide, `${recipe.name} has no guide`);
      assert.ok(guide.ingredients.length > 0, `${recipe.name} has no ingredients`);
      assert.equal(guide.method, recipe.method);
      assert.equal(guide.ice, recipe.ice);
      assert.equal(guide.glass, recipe.glass);
      assert.equal(guide.garnish, recipe.garnish);
    }
  });

  test('a measured house build keeps its amounts and steps', () => {
    const guide = recipeGuideForOrderLine('Strawberry Daiquiri');
    assert.ok(guide);
    assert.deepEqual(guide.ingredients.slice(0, 4), [
      { name: 'White Rum', amount: '50 ml' },
      { name: 'Lime Juice', amount: '25 ml' },
      { name: 'Simple Syrup', amount: '15 ml' },
      { name: 'Strawberry Purée', amount: '40 ml' },
    ]);
    assert.equal(guide.steps.length, 3);
  });

  test('a direct wine serve tells the bar what to pour and where', () => {
    const guide = recipeGuideForOrderLine('Rosé Wine');
    assert.ok(guide);
    assert.deepEqual(guide.ingredients, [{ name: 'Rosé Wine' }]);
    assert.equal(guide.method, 'Poured');
    assert.equal(guide.glass, 'Wine glass');
  });

  test('a configured house variant carries the ingredients its choices added', () => {
    const margarita = DRINKS.find((drink) => drink.name === 'Margarita');
    assert.ok(margarita);
    const line = buildLine(margarita, {
      booze: 'Boozy',
      base: 'Watermelon',
      spicy: 'Spicy',
      strength: 'Double',
      garnish: 'No',
    });
    const guide = recipeGuideForOrderLine(line.name);
    assert.ok(guide);
    const ingredients = guide.ingredients.map(({ name }) => name);
    assert.ok(ingredients.includes('Watermelon'));
    assert.ok(ingredients.includes('Fresh Chili'));
    assert.ok(ingredients.includes('Extra shot'));
    assert.equal(guide.method, 'Shaken');
  });
});
