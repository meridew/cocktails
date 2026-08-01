/**
 * The words we send people.
 *
 * These read like copy tests, and they are — but the reported defect was a copy
 * defect: "come grab your drink" is simply false when someone is carrying it to your
 * table, and a guest acting on it gets up and walks to a bar for nothing. So the
 * wording is asserted directly rather than inferred from the plumbing.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { HANDOFFS, type Handoff, type Order, type OrderStatus } from '$lib/shared';
import { guestStatusPush, newOrderPush, readyCopy, staffDecisionPush } from '$lib/server/notify';

const order = (over: Partial<Order> = {}): Order => ({
  id: 'ord1',
  name: 'Priya',
  items: [{ name: 'Moscow Mule', qty: 2 }],
  note: '',
  status: 'serving',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});
const EVENT = 'event-1';

/** Language that only makes sense if the guest is walking to the bar. */
const IMPLIES_COLLECTION = /come|grab|fetch|collect|pick .*up|at the bar/i;

describe('the ready notification', () => {
  test('says nothing about collecting when the bar did not say', () => {
    // The default has to be true whichever way the drink travels.
    const { body } = readyCopy(order({ handoff: null }));
    assert.doesNotMatch(body, IMPLIES_COLLECTION);
    assert.match(body, /ready/i);
  });

  test('an absent handoff behaves exactly like an explicit null', () => {
    // Orders placed before handoffs existed have no field at all.
    const { handoff, ...legacy } = order();
    void handoff;
    assert.deepEqual(readyCopy(legacy as Order), readyCopy(order({ handoff: null })));
  });

  test('collect tells them where to go', () => {
    const { body } = readyCopy(order({ handoff: 'collect' }));
    assert.match(body, /at the bar/i);
  });

  test('deliver tells them to stay put, and never to come over', () => {
    const { body, title } = readyCopy(order({ handoff: 'deliver' }));
    assert.doesNotMatch(body, IMPLIES_COLLECTION, 'this is the exact reported bug');
    assert.doesNotMatch(title, IMPLIES_COLLECTION);
    assert.match(body, /coming|on its way|to you/i);
  });

  test('every handoff greets the guest by name and reads as a full sentence', () => {
    const cases: (Handoff | null)[] = [...HANDOFFS, null];
    for (const handoff of cases) {
      const { title, body } = readyCopy(order({ handoff, name: 'Zoë' }));
      assert.match(body, /^Zoë,/, `${handoff}: should address the guest`);
      assert.match(body, /\.$/, `${handoff}: should end in a full stop`);
      assert.ok(title.length > 0 && title.length < 40, `${handoff}: title should be short`);
    }
  });

  test('the two handoffs really do read differently', () => {
    const collect = readyCopy(order({ handoff: 'collect' })).body;
    const deliver = readyCopy(order({ handoff: 'deliver' })).body;
    assert.notEqual(collect, deliver, 'otherwise the choice is decorative');
  });
});

describe('guestStatusPush', () => {
  test('pushes on the two moments a guest cares about, and no others', () => {
    const silent: OrderStatus[] = ['pending', 'done'];
    for (const status of silent) {
      assert.equal(guestStatusPush(order({ status }), EVENT), null, status);
    }
    assert.ok(guestStatusPush(order({ status: 'making' }), EVENT));
    assert.ok(guestStatusPush(order({ status: 'serving' }), EVENT));
  });

  test('the serving push carries the handoff wording through', () => {
    const push = guestStatusPush(order({ status: 'serving', handoff: 'deliver' }), EVENT);
    assert.equal(push?.body, readyCopy(order({ handoff: 'deliver' })).body);
  });

  test('collapses per order, so a flurry of updates cannot stack up', () => {
    // Same tag → a later notification replaces the earlier one on the device.
    assert.equal(guestStatusPush(order({ status: 'making' }), EVENT)?.tag, 'ord1');
    assert.equal(guestStatusPush(order({ status: 'serving' }), EVENT)?.tag, 'ord1');
  });

  test('sends the guest to the app, not to bartender mode', () => {
    assert.equal(guestStatusPush(order({ status: 'making' }), EVENT)?.url, `/e/${EVENT}`);
    assert.equal(guestStatusPush(order({ status: 'serving' }), EVENT)?.url, `/e/${EVENT}`);
  });
});

describe('newOrderPush', () => {
  test('summarises the order and deep-links the bar to where they act on it', () => {
    const push = newOrderPush(
      order({
        items: [
          { name: 'Mojito', qty: 2 },
          { name: 'Wine', qty: 1 },
        ],
      }),
      EVENT,
    );
    assert.match(push.body, /Priya/);
    assert.match(push.body, /2× Mojito/);
    assert.match(push.body, /1× Wine/);
    assert.equal(push.url, `/bar/${EVENT}`);
  });
});

describe('staffDecisionPush', () => {
  test('an approval says they are in and links to the bar', () => {
    const push = staffDecisionPush(true, EVENT, 'staff-1');
    assert.match(push.body, /approved/i);
    assert.equal(push.url, `/bar/${EVENT}`);
  });

  test('a decline says so plainly and offers the way forward', () => {
    const push = staffDecisionPush(false, EVENT, 'staff-1');
    assert.match(push.body, /didn’t approve/i);
    assert.match(push.body, /ask again/i);
  });

  test('both share a tag, so a decision replaces rather than repeats', () => {
    assert.equal(
      staffDecisionPush(true, EVENT, 'staff-1').tag,
      staffDecisionPush(false, EVENT, 'staff-1').tag,
    );
  });
});
