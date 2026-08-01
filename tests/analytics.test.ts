import { beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { analyticsForEvent } from '$lib/server/analytics';
import {
  clearOrders,
  createOrder,
  setItemProgress,
  setOrderStatus,
  setInStock,
} from '$lib/server/db';
import { snapshotForOrderLine } from '$lib/shared';
import { request, send } from './app';
import {
  asAccount,
  helper,
  partyFor,
  person,
  useMemoryEmail,
  type Account,
} from './fixtures/people';

let admin: Account;
let owner: Account;
let outsider: Account;
let eventId: string;
let otherEventId: string;
let helperToken: string;

beforeAll(async () => {
  useMemoryEmail();
  admin = await person('analytics-admin', 'admin');
  owner = await person('analytics-owner');
  outsider = await person('analytics-outsider');
  eventId = partyFor(owner.id, 'Analytics party');
  otherEventId = partyFor(outsider.id, 'Other analytics party');
  helperToken = await helper(admin, eventId, 'Analytics helper', 'analytics-helper-device');

  const first = createOrder(eventId, {
    name: 'Alex',
    deviceId: 'analytics-device-a',
    note: '',
    items: [{ name: 'Mojito', qty: 2, unit: snapshotForOrderLine('Mojito') }],
  });
  setItemProgress(eventId, first.id, 0, 1);
  setOrderStatus(eventId, first.id, 'making');

  const complete = createOrder(eventId, {
    name: 'Alex',
    deviceId: 'analytics-device-a',
    note: '',
    items: [
      {
        name: 'Margarita',
        qty: 1,
        unit: snapshotForOrderLine('Margarita', undefined, 'reconstructed', 100),
      },
    ],
  });
  setOrderStatus(eventId, complete.id, 'done');

  const secondAlex = createOrder(eventId, {
    name: 'Alex',
    deviceId: 'analytics-device-b',
    note: '',
    items: [{ name: 'Mojito', qty: 1, unit: snapshotForOrderLine('Mojito') }],
  });
  setOrderStatus(eventId, secondAlex.id, 'serving');

  createOrder(eventId, {
    name: 'Legacy   Name',
    note: '',
    items: [
      { name: 'Deleted custom drink', qty: 1, unit: snapshotForOrderLine('Deleted custom drink') },
    ],
  });
  createOrder(eventId, {
    name: ' legacy name ',
    note: '',
    items: [
      { name: 'Mojito', qty: 1, unit: snapshotForOrderLine('Mojito', undefined, 'reconstructed') },
    ],
  });

  clearOrders(eventId, 'done');
  createOrder(otherEventId, {
    name: 'Alex',
    deviceId: 'analytics-device-a',
    note: '',
    items: [{ name: 'Mojito', qty: 1, unit: snapshotForOrderLine('Mojito') }],
  });
});

describe('party aggregation', () => {
  test('groups by device, normalizes legacy names and includes archived orders', () => {
    const analytics = analyticsForEvent(eventId);
    assert.ok(analytics);
    assert.equal(analytics.totals.attendeeCount, 3);
    assert.equal(analytics.totals.orderedDrinks, 6);
    assert.equal(analytics.totals.servedDrinks, 3);
    assert.equal(analytics.totals.knownDrinks, 5);
    assert.equal(analytics.totals.unknownDrinks, 1);
    assert.equal(analytics.totals.reconstructedDrinks, 2);
    assert.equal(analytics.coverage.percent, (5 / 6) * 100);

    const alexRows = analytics.attendees.filter((person) => person.name === 'Alex');
    assert.equal(alexRows.length, 2, 'same display name on two devices is two attendees');
    const legacy = analytics.attendees.find((person) => person.identityBasis === 'name-only');
    assert.ok(legacy);
    assert.equal(legacy.orderedDrinks, 2, 'normalized legacy names should group together');
    assert.ok(
      analytics.popularDrinks.some((drink) => drink.name === 'Margarita'),
      'an archived completed order remains in analytics',
    );
  });

  test('uses event-scoped hashes and never exposes raw device ids', () => {
    const own = analyticsForEvent(eventId);
    const other = analyticsForEvent(otherEventId);
    assert.ok(own && other);
    const ownKey = own.attendees.find((person) => person.name === 'Alex')?.attendeeKey;
    const otherKey = other.attendees.find((person) => person.name === 'Alex')?.attendeeKey;
    assert.match(ownKey ?? '', /^[a-f0-9]{16}$/);
    assert.notEqual(ownKey, otherKey);
    assert.ok(!JSON.stringify(own).includes('analytics-device-a'));
  });
});

describe('analytics tenancy', () => {
  test('owner and admin can read attendee detail', async () => {
    for (const account of [owner, admin]) {
      const response = await request(`/api/events/${eventId}/analytics`, {
        headers: asAccount(account),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { analytics: { attendees: unknown[] } };
      assert.equal(body.analytics.attendees.length, 3);
    }
  });

  test('another host, staff and anonymous callers cannot read attendee detail', async () => {
    assert.equal(
      (await request(`/api/events/${eventId}/analytics`, { headers: asAccount(outsider) })).status,
      404,
    );
    assert.equal(
      (
        await request(`/api/events/${eventId}/analytics`, {
          headers: { Authorization: `Bearer ${helperToken}` },
        })
      ).status,
      403,
    );
    assert.equal((await request(`/api/events/${eventId}/analytics`)).status, 401);
  });

  test('history is host-scoped and contains summaries only', async () => {
    const hostResponse = await request('/api/analytics', { headers: asAccount(owner) });
    assert.equal(hostResponse.status, 200);
    const hostText = await hostResponse.text();
    assert.ok(hostText.includes(eventId));
    assert.ok(!hostText.includes(otherEventId));
    assert.ok(!hostText.includes('attendees'));
    assert.ok(!hostText.includes('Legacy Name'));

    const adminResponse = await request(`/api/analytics?hostId=${outsider.id}`, {
      headers: asAccount(admin),
    });
    const adminText = await adminResponse.text();
    assert.equal(adminResponse.status, 200);
    assert.ok(adminText.includes(otherEventId));
    assert.ok(!adminText.includes(eventId));
  });
});

describe('host alcohol profile', () => {
  test('owner and admin can update validated future-order assumptions', async () => {
    setInStock(owner.id, 'Gin', true);
    const updated = await request(
      `/api/hosts/${owner.id}/alcohol-profile`,
      send('PUT', { abv: { Gin: 42.1 }, volumes: { martini: { Gin: 55 } } }, asAccount(owner)),
    );
    assert.equal(updated.status, 200);
    const body = (await updated.json()) as {
      overrides: { abv: Record<string, number>; volumes: Record<string, Record<string, number>> };
    };
    assert.equal(body.overrides.abv.Gin, 42.1);
    assert.equal(body.overrides.volumes.martini?.Gin, 55);

    assert.equal(
      (await request(`/api/hosts/${owner.id}/alcohol-profile`, { headers: asAccount(admin) }))
        .status,
      200,
    );
  });

  test('invalid values fail and other hosts, staff and anonymous callers are denied', async () => {
    const invalid = await request(
      `/api/hosts/${owner.id}/alcohol-profile`,
      send('PUT', { abv: { Gin: 101 }, volumes: {} }, asAccount(owner)),
    );
    assert.equal(invalid.status, 422);
    assert.equal(
      (
        await request(`/api/hosts/${owner.id}/alcohol-profile`, {
          headers: asAccount(outsider),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(`/api/hosts/${owner.id}/alcohol-profile`, {
          headers: { Authorization: `Bearer ${helperToken}` },
        })
      ).status,
      404,
    );
    assert.equal((await request(`/api/hosts/${owner.id}/alcohol-profile`)).status, 401);
  });
});
