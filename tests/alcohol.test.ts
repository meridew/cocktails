import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  ALCOHOL_CATALOG_VERSION,
  RECIPES,
  alcoholCatalogueProblems,
  snapshotForOrderLine,
  snapshotForRecipe,
} from '$lib/shared';

describe('alcohol catalogue', () => {
  test('all 291 recipes have unique ids, valid sources and exact numeric coverage', () => {
    assert.equal(RECIPES.length, 291);
    assert.equal(new Set(RECIPES.map((recipe) => recipe.id)).size, RECIPES.length);
    assert.deepEqual(alcoholCatalogueProblems(), []);

    for (const recipe of RECIPES) {
      const snapshot = snapshotForRecipe(recipe, undefined, 'verified-default', 0);
      assert.equal(snapshot.catalogVersion, ALCOHOL_CATALOG_VERSION);
      assert.ok(snapshot.source.label);
      assert.ok(snapshot.source.url);
      assert.match(snapshot.source.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof snapshot.unitsPerServing, 'number');
      if (snapshot.components.length === 0) {
        assert.equal(snapshot.unitsPerServing, 0);
        assert.equal(snapshot.basis, 'alcohol-free');
      }
    }
  });

  test('sums every alcoholic component without rounding stored precision', () => {
    const recipe = RECIPES.find((candidate) => candidate.name === 'Long Island Iced Tea');
    assert.ok(recipe);
    const snapshot = snapshotForRecipe(recipe, {
      abv: { Vodka: 37.5, Gin: 41.2 },
      volumes: { [recipe.id]: { Vodka: 12.5, Gin: 17.5 } },
    });
    assert.ok(snapshot.components.length > 1);
    assert.equal(
      snapshot.unitsPerServing,
      snapshot.components.reduce(
        (total, component) => total + (component.abv * component.volumeMl) / 1000,
        0,
      ),
    );
    assert.notEqual(snapshot.unitsPerServing, Number(snapshot.unitsPerServing?.toFixed(1)));
  });

  test('host overrides take precedence and snapshots do not change with later overrides', () => {
    const recipe = RECIPES.find((candidate) => candidate.name === 'Mojito');
    assert.ok(recipe);
    const first = snapshotForRecipe(
      recipe,
      {
        abv: { 'White Rum': 37.5 },
        volumes: { [recipe.id]: { 'White Rum': 40 } },
      },
      'verified-default',
      100,
    );
    const later = snapshotForRecipe(
      recipe,
      {
        abv: { 'White Rum': 50 },
        volumes: { [recipe.id]: { 'White Rum': 60 } },
      },
      'verified-default',
      200,
    );

    assert.equal(first.unitsPerServing, 1.5);
    assert.equal(first.basis, 'host-override');
    assert.equal(first.calculatedAt, 100);
    assert.equal(later.unitsPerServing, 3);
    assert.equal(first.unitsPerServing, 1.5, 'the prior snapshot is immutable');
  });

  test('configurable alcohol-free, double, wine and unknown legacy lines are explicit', () => {
    assert.equal(snapshotForOrderLine('Mojito - Boring').unitsPerServing, null);
    const boring = snapshotForOrderLine('Mojito — Boring, Short');
    assert.equal(boring.unitsPerServing, 0);
    assert.equal(boring.basis, 'alcohol-free');

    const single = snapshotForOrderLine('Mojito — Single, Short');
    const double = snapshotForOrderLine('Mojito — Double, Short');
    assert.ok((double.unitsPerServing ?? 0) > (single.unitsPerServing ?? 0));
    assert.equal(snapshotForOrderLine('Wine — White, 1 cube').recipeId, 'white-wine');
    assert.equal(snapshotForOrderLine('Old deleted custom drink').basis, 'unknown');
    assert.equal(snapshotForOrderLine('Old deleted custom drink').unitsPerServing, null);
  });
});
