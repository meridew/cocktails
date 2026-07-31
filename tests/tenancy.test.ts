/**
 * Two hosts, two parties, no leakage. This is phase 2's gate.
 *
 * The plan calls this "the phase where a mistake is invisible and expensive": a
 * missing scope doesn't throw, it just quietly shows one host another's evening.
 * So this suite is deliberately adversarial — for every endpoint that touches
 * another party's data, it drives host A's real session at host B's real ids and
 * insists on being refused.
 *
 * Refusals are **404, not 403**. A 403 would confirm the id exists, which is a
 * smaller leak than the data but a leak all the same. The scope is part of the
 * lookup, so another host's order is simply not found.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { createStaff, genId, listOrders } from '$lib/server/db';
import {
  admittedDevice,
  barToken,
  partyFor,
  person,
  useMemoryEmail,
  type Account,
} from './fixtures/people';

interface Host {
  account: Account;
  eventId: string;
  token: string;
  orderId: string;
  staffId: string;
}

/**
 * A party with its own bar session, an order and a pending helper.
 *
 * **Each is run by a different `admin`.** That is stronger than it looks: an admin
 * passes every capability, so if scoping were done by capability alone rather than
 * by the party in the request, these tests would pass while leaking everything. The
 * isolation being asserted is the *lookup's*, not the permission's.
 */
async function makeHost(label: string): Promise<Host> {
  const account = await person(label, 'admin');
  const eventId = partyFor(account.id, `${label}'s party`);
  const token = await barToken(account, eventId);

  const staffId = genId();
  createStaff({
    id: staffId,
    eventId,
    displayName: `${label} helper`,
    deviceId: `${label}-device`,
    status: 'pending',
  });

  // The guest names their party. There is no "whichever is live" any more, which is
  // what used to make the *order* in this function load-bearing.
  const placed = await request(
    '/api/orders',
    send('POST', {
      name: `${label} guest`,
      eventId,
      items: [{ name: 'Mojito', qty: 1 }],
      deviceId: admittedDevice(eventId, label),
    }),
  );
  assert.equal(placed.status, 200);
  const orderId = ((await placed.json()) as { id: string }).id;

  return { account, eventId, token, orderId, staffId };
}

let a: Host;
let b: Host;

const as = (h: Host) => ({ Authorization: `Bearer ${h.token}` });

beforeAll(async () => {
  useMemoryEmail();
  a = await makeHost('ana');
  b = await makeHost('bruno');
  assert.notEqual(a.eventId, b.eventId, 'the two hosts must have different events');
});

describe('reading', () => {
  test('each host sees only their own queue', async () => {
    const res = await request('/api/orders', { headers: as(a) });
    assert.equal(res.status, 200);
    const { orders } = (await res.json()) as { orders: { id: string }[] };
    assert.ok(!orders.some((o) => o.id === b.orderId), "host A's queue contained host B's order");
  });

  test('and only their own staff list', async () => {
    const res = await request('/api/staff', { headers: as(a) });
    assert.equal(res.status, 200);
    const { staff } = (await res.json()) as { staff: { id: string }[] };
    assert.ok(
      !staff.some((s) => s.id === b.staffId),
      "host A's staff list contained host B's helper",
    );
  });
});

describe('mutating another host’s order', () => {
  const cases: { name: string; path: (h: Host) => string; init: () => object }[] = [
    {
      name: 'advance it',
      path: (h) => `/api/orders/${h.orderId}`,
      init: () => send('PATCH', { status: 'making' }),
    },
    {
      name: 'delete it',
      path: (h) => `/api/orders/${h.orderId}`,
      init: () => ({ method: 'DELETE' }),
    },
    {
      name: 'bump it',
      path: (h) => `/api/orders/${h.orderId}/bump`,
      init: () => send('POST', { bumped: true }),
    },
    {
      name: 'record progress on it',
      path: (h) => `/api/orders/${h.orderId}/progress`,
      init: () => send('PATCH', { index: 0, made: 1 }),
    },
  ];

  for (const c of cases) {
    test(`host A cannot ${c.name}`, async () => {
      const res = await request(c.path(b), {
        ...c.init(),
        headers: { 'Content-Type': 'application/json', ...as(a) },
      });
      assert.equal(res.status, 404, `${c.name} should be not-found across tenants`);
    });
  }

  test("and B's order is untouched afterwards", async () => {
    const still = listOrders(b.eventId).find((o) => o.id === b.orderId);
    assert.ok(still, "host B's order was destroyed by host A");
    assert.equal(still.status, 'pending', 'host A advanced host B’s order');
    assert.equal(still.bumpedAt, null, 'host A bumped host B’s order');
  });
});

describe('clearing', () => {
  test("host A clearing everything leaves host B's queue alone", async () => {
    const res = await request('/api/orders/clear', {
      ...send('POST', { which: 'all' }),
      headers: { 'Content-Type': 'application/json', ...as(a) },
    });
    assert.equal(res.status, 200);

    assert.equal(listOrders(a.eventId).length, 0, "host A's own queue should be empty");
    assert.ok(
      listOrders(b.eventId).some((o) => o.id === b.orderId),
      "host A's clear deleted host B's orders",
    );
  });
});

describe('staff', () => {
  test("host A cannot approve host B's helper", async () => {
    const res = await request(`/api/staff/${b.staffId}/approve`, {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', ...as(a) },
    });
    assert.equal(res.status, 404, 'approving across tenants should be not-found');
  });

  test("host A cannot revoke host B's helper", async () => {
    const res = await request(`/api/staff/${b.staffId}/revoke`, {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', ...as(a) },
    });
    assert.equal(res.status, 404, 'revoking across tenants should be not-found');
  });

  test("host A cannot delete host B's helper", async () => {
    const res = await request(`/api/staff/${b.staffId}`, { method: 'DELETE', headers: as(a) });
    assert.equal(res.status, 404, 'deleting across tenants should be not-found');
  });

  test("host A's revoke-all does not touch host B's helpers", async () => {
    const res = await request('/api/staff/revoke-all', {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', ...as(a) },
    });
    assert.equal(res.status, 200);

    const list = await request('/api/staff', { headers: as(b) });
    const { staff } = (await list.json()) as { staff: { id: string; status: string }[] };
    const helper = staff.find((s) => s.id === b.staffId);
    assert.ok(helper, "host B's helper vanished");
    assert.notEqual(helper.status, 'revoked', "host A's revoke-all reached host B's helper");
  });
});
