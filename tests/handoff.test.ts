/**
 * Serve vs deliver.
 *
 * The property that matters is that the guest is never told the wrong story: an
 * unspecified handoff stays neutral rather than defaulting to "come and get it",
 * an explicit choice is recorded, and stepping back before serving forgets it so a
 * re-serve can't reuse stale wording.
 */
import { test, describe, beforeAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { HANDOFFS, HANDOFF_META, STATUS_META, isHandoff, type Order } from '$lib/shared';
import { request } from './app';
import { hashPassword } from '$lib/server/auth';
import { createStaff, genId, clearOrders } from '$lib/server/db';

const STAFF = { email: 'handoff@local', password: 'handoff-pw' };
let token = '';

const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const auth = () => ({ Authorization: `Bearer ${token}` });

async function place(name: string): Promise<Order> {
  const res = await request(
    '/api/orders',
    send('POST', { name, items: [{ name: 'Mojito', qty: 1 }] }),
  );
  return ((await res.json()) as { order: Order }).order;
}

/** PATCH the status (optionally with a handoff) and return the updated order. */
async function patch(id: string, body: Record<string, unknown>): Promise<Order> {
  const res = await request(`/api/orders/${id}`, send('PATCH', body, auth()));
  assert.equal(res.status, 200, JSON.stringify(body));
  return ((await res.json()) as { order: Order }).order;
}

beforeAll(async () => {
  createStaff({
    id: genId(),
    displayName: 'Handoff Staff',
    email: STAFF.email,
    passwordHash: await hashPassword(STAFF.password),
    role: 'admin',
    status: 'active',
  });
  const res = await request('/api/auth/login', send('POST', STAFF));
  token = ((await res.json()) as { token: string }).token;
});

beforeEach(() => clearOrders('all'));

describe('the handoff contract', () => {
  test('every handoff has a bar-facing label and a distinct action class', () => {
    const classes = new Set(HANDOFFS.map((h) => HANDOFF_META[h].actionClass));
    assert.equal(classes.size, HANDOFFS.length, 'two handoffs sharing a colour is a UI bug');
    for (const h of HANDOFFS) {
      assert.ok(HANDOFF_META[h].label.length > 0);
      assert.ok(HANDOFF_META[h].icon.length > 0);
    }
  });

  test('the ready action stays neutral about where the drink is', () => {
    // This is the whole point: the one-tap forward action must not tell a guest to
    // walk to the bar when someone may be walking the drink to them.
    const label = STATUS_META.making.nextLabel ?? '';
    assert.doesNotMatch(label, /grab|collect|come|bar/i);
  });

  test('isHandoff accepts only the two known values', () => {
    assert.ok(isHandoff('collect'));
    assert.ok(isHandoff('deliver'));
    for (const bad of ['Collect', 'delivered', '', null, 1, {}]) assert.ok(!isHandoff(bad));
  });
});

describe('recording a handoff', () => {
  test('an order starts with none, and serving without a choice keeps it that way', async () => {
    const order = await place('Dan');
    assert.equal(order.handoff ?? null, null);
    const serving = await patch(order.id, { status: 'serving' });
    assert.equal(serving.status, 'serving');
    assert.equal(serving.handoff ?? null, null, 'silence must stay silence');
  });

  test('an explicit choice is stored and survives later status changes', async () => {
    const order = await place('Priya');
    const serving = await patch(order.id, { status: 'serving', handoff: 'deliver' });
    assert.equal(serving.handoff, 'deliver');
    // Completing the order shouldn't erase how it was handed over.
    const done = await patch(order.id, { status: 'done' });
    assert.equal(done.handoff, 'deliver');
  });

  test('both choices round-trip through the queue listing', async () => {
    for (const choice of HANDOFFS) {
      await clearOrders('all');
      const order = await place(`Guest ${choice}`);
      await patch(order.id, { status: 'serving', handoff: choice });
      const res = await request('/api/orders', { headers: auth() });
      const { orders } = (await res.json()) as { orders: Order[] };
      assert.equal(orders[0]?.handoff, choice);
    }
  });

  test('stepping back before the serve forgets the choice', async () => {
    const order = await place('Sam');
    await patch(order.id, { status: 'serving', handoff: 'collect' });
    // Undo: this drink is not, in fact, ready.
    const back = await patch(order.id, { status: 'making' });
    assert.equal(back.handoff ?? null, null, 'a stale choice would mis-notify on re-serve');
    // Re-serving without saying anything must not resurrect 'collect'.
    const again = await patch(order.id, { status: 'serving' });
    assert.equal(again.handoff ?? null, null);
  });

  test('an unrecognised handoff is ignored rather than rejected', async () => {
    // An older client knows nothing about handoffs; a newer one might send junk.
    // Neither should fail to advance an order.
    const order = await place('Alex');
    const serving = await patch(order.id, { status: 'serving', handoff: 'teleport' });
    assert.equal(serving.status, 'serving');
    assert.equal(serving.handoff ?? null, null);
  });

  test('a handoff cannot be used to smuggle a status past validation', async () => {
    const order = await place('Nina');
    const res = await request(
      `/api/orders/${order.id}`,
      send('PATCH', { status: 'teleporting', handoff: 'collect' }, auth()),
    );
    assert.equal(res.status, 422);
  });

  test('is staff-only', async () => {
    const order = await place('Dan');
    const res = await request(
      `/api/orders/${order.id}`,
      send('PATCH', { status: 'serving', handoff: 'deliver' }),
    );
    assert.equal(res.status, 401);
  });
});
