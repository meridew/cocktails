/**
 * Bar-queue controls: stepping a status back, bumping to the front, and recording
 * how many of a line have been poured.
 *
 * The properties that matter: progress is clamped server-side (never trusted from
 * the client), the item name/qty can't be rewritten through the progress endpoint,
 * and all of it is staff-only.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_META, orderProgress, type Order } from '@cocktails/shared';
import { app } from '../src/app.ts';
import { hashPassword } from '../src/auth.ts';
import { createStaff, genId, clearOrders } from '../src/db.ts';

const STAFF = { email: 'queue@local', password: 'queue-pw' };
let token = '';

const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const auth = () => ({ Authorization: `Bearer ${token}` });

/** Place an order with the given lines and return it. */
async function place(name: string, items: { name: string; qty: number }[]): Promise<Order> {
  const res = await app.request('/api/orders', send('POST', { name, items }));
  assert.equal(res.status, 200);
  return ((await res.json()) as { order: Order }).order;
}

const listOrders = async (): Promise<Order[]> => {
  const res = await app.request('/api/orders', { headers: auth() });
  assert.equal(res.status, 200);
  return ((await res.json()) as { orders: Order[] }).orders;
};

before(async () => {
  createStaff({
    id: genId(),
    displayName: 'Queue Staff',
    email: STAFF.email,
    passwordHash: await hashPassword(STAFF.password),
    role: 'admin',
    status: 'active',
  });
  const res = await app.request('/api/auth/login', send('POST', STAFF));
  token = ((await res.json()) as { token: string }).token;
  assert.ok(token);
});

beforeEach(() => clearOrders('all'));

describe('stepping a status back', () => {
  test('every status except the first declares a previous one', () => {
    assert.equal(STATUS_META.pending.prev, null, 'nothing precedes a new order');
    assert.equal(STATUS_META.making.prev, 'pending');
    assert.equal(STATUS_META.serving.prev, 'making');
    assert.equal(STATUS_META.done.prev, 'serving');
  });

  test('walking back down the chain works over HTTP', async () => {
    // No new endpoint is needed: PATCH accepts any valid status, so undoing a
    // mis-tap is just a transition in the other direction.
    const order = await place('Dan', [{ name: 'Mojito', qty: 1 }]);
    for (const status of ['making', 'serving', 'done']) {
      await app.request(`/api/orders/${order.id}`, send('PATCH', { status }, auth()));
    }
    for (const status of ['serving', 'making', 'pending']) {
      const res = await app.request(`/api/orders/${order.id}`, send('PATCH', { status }, auth()));
      assert.equal(res.status, 200, `back to ${status}`);
      assert.equal(((await res.json()) as { order: Order }).order.status, status);
    }
  });
});

describe('bumping to the front', () => {
  test('a bumped order sorts ahead of older ones, newest bump first', async () => {
    const first = await place('First', [{ name: 'Mojito', qty: 1 }]);
    const second = await place('Second', [{ name: 'Wine', qty: 1 }]);
    const third = await place('Third', [{ name: 'Margarita', qty: 1 }]);

    // Oldest-first by default.
    assert.deepEqual(
      (await listOrders()).map((o) => o.name),
      ['First', 'Second', 'Third'],
    );

    const res = await app.request(`/api/orders/${third.id}/bump`, send('POST', {}, auth()));
    assert.equal(res.status, 200);
    assert.deepEqual(
      (await listOrders()).map((o) => o.name),
      ['Third', 'First', 'Second'],
    );

    // Bumping another puts it ahead of the first bump.
    await app.request(`/api/orders/${second.id}/bump`, send('POST', {}, auth()));
    assert.deepEqual(
      (await listOrders()).map((o) => o.name),
      ['Second', 'Third', 'First'],
    );

    // And un-bumping restores natural order.
    await app.request(`/api/orders/${second.id}/bump`, send('POST', { bumped: false }, auth()));
    await app.request(`/api/orders/${third.id}/bump`, send('POST', { bumped: false }, auth()));
    assert.deepEqual(
      (await listOrders()).map((o) => o.name),
      ['First', 'Second', 'Third'],
    );
    void first;
  });

  test('bump reports bumpedAt, and 404s for an unknown order', async () => {
    const order = await place('Dan', [{ name: 'Mojito', qty: 1 }]);
    const res = await app.request(`/api/orders/${order.id}/bump`, send('POST', {}, auth()));
    const { order: bumped } = (await res.json()) as { order: Order };
    assert.equal(typeof bumped.bumpedAt, 'number');

    const missing = await app.request('/api/orders/nope/bump', send('POST', {}, auth()));
    assert.equal(missing.status, 404);
  });

  test('is staff-only', async () => {
    const order = await place('Dan', [{ name: 'Mojito', qty: 1 }]);
    const res = await app.request(`/api/orders/${order.id}/bump`, send('POST', {}));
    assert.equal(res.status, 401);
  });
});

describe('per-drink progress', () => {
  test('records how many of a line are poured', async () => {
    const order = await place('Priya', [
      { name: 'Moscow Mule', qty: 3 },
      { name: 'Wine', qty: 1 },
    ]);
    assert.deepEqual(orderProgress(order), { made: 0, total: 4, complete: false });

    const res = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 0, made: 2 }, auth()),
    );
    assert.equal(res.status, 200);
    const { order: updated } = (await res.json()) as { order: Order };
    assert.equal(updated.items[0]?.made, 2);
    assert.equal(updated.items[1]?.made ?? 0, 0, 'other lines are untouched');
    assert.deepEqual(orderProgress(updated), { made: 2, total: 4, complete: false });
  });

  test('clamps to the line quantity, and never below zero', async () => {
    const order = await place('Priya', [{ name: 'Moscow Mule', qty: 3 }]);

    const over = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 0, made: 99 }, auth()),
    );
    assert.equal(((await over.json()) as { order: Order }).order.items[0]?.made, 3);

    const under = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 0, made: -5 }, auth()),
    );
    assert.equal(((await under.json()) as { order: Order }).order.items[0]?.made, 0);
  });

  test('completing every line reports complete', async () => {
    const order = await place('Priya', [
      { name: 'Moscow Mule', qty: 2 },
      { name: 'Wine', qty: 1 },
    ]);
    await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 0, made: 2 }, auth()),
    );
    const res = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 1, made: 1 }, auth()),
    );
    const { order: done } = (await res.json()) as { order: Order };
    assert.deepEqual(orderProgress(done), { made: 3, total: 3, complete: true });
  });

  test('cannot rewrite the drink itself through the progress endpoint', async () => {
    const order = await place('Priya', [{ name: 'Moscow Mule', qty: 3 }]);
    // A hostile payload carrying name/qty must be ignored: only the count moves.
    const res = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 0, made: 1, name: 'Free Champagne', qty: 99 }, auth()),
    );
    const { order: updated } = (await res.json()) as { order: Order };
    assert.equal(updated.items[0]?.name, 'Moscow Mule');
    assert.equal(updated.items[0]?.qty, 3);
    assert.equal(updated.items[0]?.made, 1);
  });

  test('rejects a bad index or missing fields, and 404s an unknown order', async () => {
    const order = await place('Priya', [{ name: 'Moscow Mule', qty: 3 }]);
    for (const body of [{}, { index: 'x', made: 1 }, { index: -1, made: 1 }, { index: 0 }]) {
      const res = await app.request(
        `/api/orders/${order.id}/progress`,
        send('PATCH', body, auth()),
      );
      assert.equal(res.status, 422, JSON.stringify(body));
    }
    // An index past the end is "not found" rather than a silent no-op.
    const past = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 9, made: 1 }, auth()),
    );
    assert.equal(past.status, 404);

    const missing = await app.request(
      '/api/orders/nope/progress',
      send('PATCH', { index: 0, made: 1 }, auth()),
    );
    assert.equal(missing.status, 404);
  });

  test('is staff-only', async () => {
    const order = await place('Priya', [{ name: 'Moscow Mule', qty: 3 }]);
    const res = await app.request(
      `/api/orders/${order.id}/progress`,
      send('PATCH', { index: 0, made: 1 }),
    );
    assert.equal(res.status, 401);
  });
});
