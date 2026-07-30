/**
 * Contract invariants for @cocktails/shared. These are what stop the front and
 * back drifting — in particular, they fire the day someone adds a 5th status.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_STATUSES,
  STATUS_META,
  isOrderStatus,
  LIMITS,
  type OrderStatus,
} from '@cocktails/shared';

describe('isOrderStatus', () => {
  test('accepts every declared status', () => {
    for (const s of ORDER_STATUSES) assert.equal(isOrderStatus(s), true, s);
  });

  test('rejects anything else', () => {
    for (const v of ['cooking', '', 'Pending', 'PENDING', null, undefined, 0, 1, {}, ['pending']]) {
      assert.equal(isOrderStatus(v), false, JSON.stringify(v));
    }
  });
});

describe('STATUS_META', () => {
  test('covers exactly the declared statuses — no extras, none missing', () => {
    assert.deepEqual(Object.keys(STATUS_META).sort(), [...ORDER_STATUSES].sort());
  });

  test('ranks are unique and ascend in declaration order', () => {
    const ranks = ORDER_STATUSES.map((s) => STATUS_META[s].rank);
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
      'ranks are not ascending',
    );
    assert.equal(new Set(ranks).size, ranks.length, 'ranks are not unique');
  });

  test('the next-chain from pending visits every status once and terminates', () => {
    const seen: OrderStatus[] = [];
    let cursor: OrderStatus | null = 'pending';
    while (cursor) {
      assert.ok(!seen.includes(cursor), `cycle detected at ${cursor}`);
      seen.push(cursor);
      cursor = STATUS_META[cursor].next;
    }
    assert.deepEqual(seen, [...ORDER_STATUSES], 'chain does not cover all statuses in order');
    assert.equal(STATUS_META[seen[seen.length - 1]!].next, null, 'chain does not terminate');
  });

  test('next and nextLabel are null together', () => {
    for (const s of ORDER_STATUSES) {
      const { next, nextLabel } = STATUS_META[s];
      assert.equal(next === null, nextLabel === null, `${s}: next/nextLabel disagree`);
      if (next !== null)
        assert.equal(isOrderStatus(next), true, `${s}: next is not a valid status`);
    }
  });

  test('every badge and label is a non-empty string', () => {
    for (const s of ORDER_STATUSES) {
      assert.ok(STATUS_META[s].badge.length > 0, `${s} badge`);
      assert.ok(STATUS_META[s].label.length > 0, `${s} label`);
    }
  });
});

describe('LIMITS', () => {
  test('every limit is a positive integer', () => {
    for (const [k, v] of Object.entries(LIMITS)) {
      assert.equal(Number.isInteger(v), true, `${k} is not an integer`);
      assert.ok((v as number) > 0, `${k} is not positive`);
    }
  });
});
