/**
 * The shared input sanitisers. These run on the server to enforce the rules and
 * back the client's `maxlength`, so they are the one place the two sides agree.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStr, cleanQty, cleanItems, LIMITS } from '@cocktails/shared';

describe('cleanStr', () => {
  test('trims and passes ordinary text through', () => {
    assert.equal(cleanStr('  Daniel  '), 'Daniel');
    assert.equal(cleanStr('Margarita — Spicy, Double'), 'Margarita — Spicy, Double');
  });

  test('coerces non-strings to empty', () => {
    for (const v of [undefined, null, 42, {}, [], true]) assert.equal(cleanStr(v), '');
  });

  test('drops control characters', () => {
    assert.equal(cleanStr('\u0000Dan\u0007'), 'Dan');
    assert.equal(cleanStr('a\u007fb'), 'ab');
  });

  test('turns newlines and tabs into spaces instead of gluing words together', () => {
    // Dropping them outright produced "No ice!Extra lime!" on the bar card.
    assert.equal(cleanStr('No ice!\nExtra lime!'), 'No ice! Extra lime!');
    assert.equal(cleanStr('No ice!\r\nExtra lime!'), 'No ice! Extra lime!');
    assert.equal(cleanStr('a\tb'), 'a b');
    assert.equal(cleanStr('line1\n\n\nline2'), 'line1 line2', 'runs collapse to one space');
  });

  test('caps length by code point, never splitting an emoji', () => {
    const max = LIMITS.maxFieldLen;
    // 139 plain characters + one astral emoji = 141 UTF-16 units but 140 code
    // points, so nothing should be cut. Slicing by unit would leave half a
    // surrogate pair and corrupt the value.
    const exact = 'x'.repeat(max - 1) + '🍹';
    const cleaned = cleanStr(exact);
    assert.equal([...cleaned].length, max);
    assert.ok(cleaned.endsWith('🍹'), 'the emoji must survive intact');
    assert.ok(!/[\uD800-\uDFFF]/.test(cleaned.replace(/🍹/g, '')), 'no lone surrogate');

    // One code point over the cap: the emoji is dropped whole, not halved.
    const over = 'x'.repeat(max) + '🍹';
    const trimmed = cleanStr(over);
    assert.equal([...trimmed].length, max);
    assert.ok(!/[\uD800-\uDFFF]/.test(trimmed), 'must not end in a lone surrogate');
  });

  test('honours a custom max', () => {
    assert.equal(cleanStr('abcdef', 3), 'abc');
  });
});

describe('cleanQty', () => {
  test('defaults to 1 for missing, non-numeric, or below-range values', () => {
    for (const v of [undefined, null, 'abc', NaN, Infinity, -Infinity, 0, -5, 0.4]) {
      assert.equal(cleanQty(v), 1, JSON.stringify(v));
    }
  });

  test('clamps to the shared maximum and floors fractions', () => {
    assert.equal(cleanQty(2.7), 2);
    assert.equal(cleanQty(1000), LIMITS.maxQty);
    assert.equal(cleanQty(LIMITS.maxQty), LIMITS.maxQty);
    assert.equal(cleanQty('3'), 3, 'numeric strings are accepted');
  });
});

describe('cleanItems', () => {
  test('returns empty for anything that is not an array', () => {
    for (const v of [undefined, null, 'nope', 42, {}]) assert.deepEqual(cleanItems(v), []);
  });

  test('cleans names, coerces quantities, and drops unusable entries', () => {
    assert.deepEqual(
      cleanItems([
        { name: '  Mojito  ', qty: 2 },
        { name: '', qty: 1 }, // no name → cannot be made
        null,
        'nope',
        { qty: 3 }, // no name
        { name: 'Wine' }, // no qty → 1
      ]),
      [
        { name: 'Mojito', qty: 2 },
        { name: 'Wine', qty: 1 },
      ],
    );
  });

  test('caps the number of items', () => {
    const many = Array.from({ length: LIMITS.maxItemsPerOrder + 25 }, (_, i) => ({
      name: `Drink ${i}`,
      qty: 1,
    }));
    assert.equal(cleanItems(many).length, LIMITS.maxItemsPerOrder);
  });

  test('preserves order', () => {
    assert.deepEqual(
      cleanItems([{ name: 'A' }, { name: 'B' }, { name: 'C' }]).map((i) => i.name),
      ['A', 'B', 'C'],
    );
  });
});
