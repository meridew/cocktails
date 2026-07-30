/**
 * The basket rune store. Module-level singleton state, so every test clears it first.
 * (`$state` is provided by the shim in tests/setup.ts — see the note there.)
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '@cocktails/shared';
import { basket, addLine, setQty, clearBasket, basketCount } from '../src/lib/basket.svelte.ts';

beforeEach(() => clearBasket());

describe('basket store', () => {
  test('addLine dedupes by name and increments quantity', () => {
    addLine('Margarita — Single');
    addLine('Margarita — Single');
    assert.equal(basket.items.length, 1);
    assert.equal(basket.items[0]?.qty, 2);
  });

  test('different lines are appended in insertion order', () => {
    addLine('Mojito');
    addLine('Wine — Red');
    assert.deepEqual(
      basket.items.map((i) => i.name),
      ['Mojito', 'Wine — Red'],
    );
  });

  test('setQty clamps to the shared max quantity', () => {
    addLine('Mojito');
    setQty('Mojito', 500);
    assert.equal(basket.items[0]?.qty, LIMITS.maxQty);
  });

  test('setQty to zero or negative removes the line', () => {
    addLine('Mojito');
    setQty('Mojito', 0);
    assert.equal(basket.items.length, 0);

    addLine('Wine');
    setQty('Wine', -1);
    assert.equal(basket.items.length, 0);
  });

  test('setQty on an unknown line is a no-op', () => {
    addLine('Mojito');
    assert.doesNotThrow(() => setQty('Nope', 5));
    assert.equal(basket.items.length, 1);
    assert.equal(basket.items[0]?.qty, 1);
  });

  test('basketCount sums quantities, not lines', () => {
    assert.equal(basketCount(), 0);
    addLine('Mojito');
    addLine('Mojito');
    addLine('Wine');
    assert.equal(basket.items.length, 2);
    assert.equal(basketCount(), 3);
  });

  test('clearBasket empties it', () => {
    addLine('Mojito');
    clearBasket();
    assert.deepEqual(basket.items, []);
    assert.equal(basketCount(), 0);
  });
});
