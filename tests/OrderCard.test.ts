// @vitest-environment jsdom
/**
 * A big round does not take over the queue.
 *
 * **This exists because card height was running 63px to 171px** — ten orders on a
 * screen at one end and four at the other. Measured in the browser, the tall end was
 * entirely multi-kind rounds: one line per kind of drink, unbounded.
 *
 * The fix was a cap, not a fixed height. Padding every card to the tallest would
 * have cost the density this screen was rebuilt to win, and truncating to the
 * shortest would have hidden *what to make* on exactly the biggest orders. So a
 * collapsed card lists three kinds and says how many it is holding back, and
 * expanding shows the lot.
 *
 * Asserted on the clamp rather than on pixel heights: the height is a CSS
 * consequence of how many lines render, and the line count is the thing this
 * component decides. `e2e/layout.spec.ts` is where rendered geometry is checked.
 */
import { test, describe, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/svelte';
import OrderCard from '$lib/components/OrderCard.svelte';
import type { Order } from '$lib/shared';

afterEach(cleanup);

/** A round of `kinds` different drinks, one of each. */
function bigRound(kinds: number): Order {
  return {
    id: 'o1',
    name: 'Rosalind',
    items: Array.from({ length: kinds }, (_, i) => ({ name: `Drink ${i + 1}`, qty: 1 })),
    note: '',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bumpedAt: null,
    handoff: null,
  } as Order;
}

const noop = () => {};

const draw = (order: Order, expanded: boolean) =>
  render(OrderCard, {
    props: {
      order,
      // The avatar needs to know which party, so it can fetch a face the guard will
      // hand over. Nothing here has a photo, so it renders initials and never fetches.
      eventId: 'test-party',
      busy: false,
      expanded,
      ontoggle: noop,
      onact: noop,
      onbump: noop,
      onprogress: noop,
      ondelete: noop,
      onadmit: noop,
    },
  });

describe('a collapsed order card', () => {
  test('lists a short round in full, with nothing held back', () => {
    const { container } = draw(bigRound(3), false);
    assert.equal(container.querySelectorAll('.ord-drink').length, 3);
    assert.equal(container.querySelector('.ord-more-kinds'), null, 'nothing to hold back');
  });

  test('caps a long round and says how much it is holding back', () => {
    const { container } = draw(bigRound(7), false);
    const shown = container.querySelectorAll('.ord-drink').length;

    assert.ok(shown <= 3, `a collapsed card listed ${shown} kinds; the cap is 3`);
    assert.equal(
      container.querySelector('.ord-more-kinds')?.textContent?.trim(),
      `+${7 - shown} more`,
      'the count of hidden drinks has to be real, or it is worse than no number at all',
    );
  });

  test('and expanding shows every one of them', () => {
    // The cap must never be the only view of an order: a bartender has to be able to
    // read the whole round before making it.
    const { container } = draw(bigRound(7), true);
    assert.equal(container.querySelectorAll('.ord-drink').length, 7);
    assert.equal(container.querySelector('.ord-more-kinds'), null);
  });
});

describe('the meta line carries what used to be its own rows', () => {
  test('the poured count rides the status line rather than taking a row', () => {
    // "0/3 poured" was a row of its own, and with the note peek it accounted for
    // most of the ragged height: three otherwise identical single-drink cards
    // measured 63, 79 and 95px purely on which of the two were present.
    const order = { ...bigRound(1), items: [{ name: 'Margarita', qty: 3, made: 1 }] } as Order;
    const { container } = draw(order, false);

    const count = container.querySelector('.ord-meta .ord-count');
    assert.ok(count, 'the count belongs on the meta line');
    assert.equal(count.textContent?.trim(), '1/3');
    assert.equal(container.querySelector('.ord-progress'), null, 'no row of its own');
  });

  test('a note is a marker on that line, and keeps its text reachable', () => {
    const order = { ...bigRound(1), note: 'light on the lime' } as Order;
    const { container } = draw(order, false);

    const mark = container.querySelector('.ord-meta .ord-note-mark');
    assert.ok(mark, 'a note gets a marker');
    // The peek was `nowrap` + ellipsis, so on a phone it truncated mid-sentence. The
    // full text has to survive somewhere the bartender can reach without guessing.
    assert.equal(mark.getAttribute('title'), 'light on the lime');
    assert.equal(container.querySelector('.ord-note-peek'), null, 'no row of its own');
  });
});
