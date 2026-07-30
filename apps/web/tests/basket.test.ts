/**
 * The basket rune store. Module-level singleton state, so every test clears it first.
 * (Runes are compiled for real here — see vitest.config.ts.)
 */
import { test, describe, beforeEach } from 'vitest';
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

  test('addLine also clamps, so repeated taps cannot exceed the max', () => {
    // setQty clamped but addLine did not, so the count could pass the bound and
    // then be silently reduced by the server.
    for (let i = 0; i < LIMITS.maxQty + 20; i++) addLine('Mojito');
    assert.equal(basket.items[0]?.qty, LIMITS.maxQty);
  });

  test('addLine stops at the per-order item cap', () => {
    for (let i = 0; i < LIMITS.maxItemsPerOrder + 10; i++) addLine(`Drink ${i}`);
    assert.equal(basket.items.length, LIMITS.maxItemsPerOrder);
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
