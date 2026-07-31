/**
 * The whole loop, as the people in it actually walk it:
 *
 *   a host registers → Dan creates their party → Dan opens its bar →
 *   guests at *that* party order → the host watches, and can do nothing else
 *
 * **The shape of this changed.** It used to be one person doing everything: a host
 * signed up, made their own party, and opened their own bar. That was never the
 * business — a host is a customer and Dan is the operator — so the loop now has two
 * people in it, and the interesting assertions are the ones about where one stops
 * and the other starts.
 *
 * This exists alongside `tenancy.test.ts` because that one builds each host in turn
 * and never exercises the guest side. Here two parties are live at once, which is
 * now the normal case rather than the edge one.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { asAccount, person, useMemoryEmail, type Account } from './fixtures/people';

interface Party {
  host: Account;
  eventId: string;
  barToken: string;
}

let dan: Account;
let ana: Party;
let bruno: Party;

/**
 * Assert 200 and hand back the parsed body, reading the stream **once**.
 *
 * A Response body is a stream: consuming it for an assertion message and again for
 * JSON throws "Body has already been read", and the failure surfaces in beforeAll
 * where it looks like nothing ran.
 */
async function okJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, 200, `${what} → ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/** A registered host, with a party Dan made for them and a bar Dan opened. */
async function party(label: string): Promise<Party> {
  const host = await person(label);

  const created = await request('/api/events', {
    ...send('POST', { hostUserId: host.id, name: `${label}'s party` }),
    headers: { 'Content-Type': 'application/json', ...asAccount(dan) },
  });
  const { event } = await okJson<{ event: { id: string; hostUserId: string; status: string } }>(
    created,
    'create party',
  );
  assert.equal(event.hostUserId, host.id, 'the party belongs to the host, not to Dan');
  assert.equal(event.status, 'draft', 'a party is born draft and opened by hand');

  const bar = await request(`/api/events/${event.id}/bar`, {
    ...send('POST', {}),
    headers: { 'Content-Type': 'application/json', ...asAccount(dan) },
  });
  const { token } = await okJson<{ token: string }>(bar, 'open bar');

  return { host, eventId: event.id, barToken: token };
}

/** A guest orders at a named party. */
async function order(eventId: string, who: string): Promise<string> {
  const res = await request(
    '/api/orders',
    send('POST', { eventId, name: who, items: [{ name: 'Mojito', qty: 1 }] }),
  );
  return (await okJson<{ id: string }>(res, `order for ${who}`)).id;
}

/** The queue a credential can see. */
async function queue(headers: Record<string, string>, eventId?: string): Promise<{ id: string }[]> {
  const path = eventId ? `/api/orders?eventId=${eventId}` : '/api/orders';
  const res = await request(path, { headers });
  assert.equal(res.status, 200);
  return ((await res.json()) as { orders: { id: string }[] }).orders;
}

const asBar = (p: Party) => ({ Authorization: `Bearer ${p.barToken}` });

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('loop-dan', 'admin');
  ana = await party('loop-ana');
  bruno = await party('loop-bruno');
});

describe('registering leads somewhere', () => {
  test('a host exists before they have a party, and that is a normal state', async () => {
    const nobody = await person('loop-nobody');
    const res = await request('/api/events', { headers: asAccount(nobody) });
    const { events } = await okJson<{ events: unknown[] }>(res, 'their own parties');
    assert.deepEqual(events, [], 'no parties yet is not an error');
  });

  test('a host cannot create a party for themselves', async () => {
    // A booking is a conversation; Dan makes the event. This is the line between
    // customer and operator, and the one most likely to erode.
    const res = await request('/api/events', {
      ...send('POST', { hostUserId: ana.host.id, name: 'Sneaky' }),
      headers: { 'Content-Type': 'application/json', ...asAccount(ana.host) },
    });
    assert.equal(res.status, 403, 'party:create is Admin only');
  });

  test('and cannot create one for somebody else either', async () => {
    const res = await request('/api/events', {
      ...send('POST', { hostUserId: bruno.host.id, name: 'Sneakier' }),
      headers: { 'Content-Type': 'application/json', ...asAccount(ana.host) },
    });
    assert.equal(res.status, 403);
  });

  test('a party needs a host who actually exists', async () => {
    const res = await request('/api/events', {
      ...send('POST', { hostUserId: 'nobody-at-all', name: 'Orphan' }),
      headers: { 'Content-Type': 'application/json', ...asAccount(dan) },
    });
    assert.equal(res.status, 404, 'no host, no cupboard, no menu');
  });
});

describe('two parties running at the same time', () => {
  test("each bar sees only its own guests' drinks", async () => {
    const forAna = await order(ana.eventId, 'ana guest');
    const forBruno = await order(bruno.eventId, 'bruno guest');

    assert.deepEqual(
      (await queue(asBar(ana))).map((o) => o.id),
      [forAna],
      "ana's bar should hold exactly her guest's drink",
    );
    assert.deepEqual(
      (await queue(asBar(bruno))).map((o) => o.id),
      [forBruno],
      "bruno's bar should hold exactly his guest's drink",
    );
  });

  test('ordering at a party that does not exist is refused', async () => {
    const res = await request(
      '/api/orders',
      send('POST', { eventId: 'nope', name: 'Lost', items: [{ name: 'Wine', qty: 1 }] }),
    );
    assert.equal(res.status, 404, 'an unknown party must not silently become a live one');
  });

  test('a guest who names no party is refused rather than guessed at', async () => {
    // There is no `liveEvent()` any more. With several parties running a guess is
    // wrong *silently* — the guest orders at a stranger's bar and nothing says so.
    const res = await request(
      '/api/orders',
      send('POST', { name: 'Vague', items: [{ name: 'Wine', qty: 1 }] }),
    );
    assert.equal(res.status, 404);
  });
});

describe('what a host may do at their own party', () => {
  test('watch the queue', async () => {
    const mine = await queue(asAccount(ana.host), ana.eventId);
    assert.ok(Array.isArray(mine), 'the owner can read their own queue');
  });

  test('and nothing else — not even at their own party', async () => {
    const orders = await queue(asBar(ana));
    const target = orders[0];
    assert.ok(target, 'there should be a drink to try to touch');

    const advance = await request(`/api/orders/${target.id}?eventId=${ana.eventId}`, {
      ...send('PATCH', { status: 'making' }),
      headers: { 'Content-Type': 'application/json', ...asAccount(ana.host) },
    });
    assert.equal(advance.status, 403, 'a host is a customer: Dan pours');

    const staff = await request(`/api/staff?eventId=${ana.eventId}`, {
      headers: asAccount(ana.host),
    });
    assert.equal(staff.status, 403, 'and does not decide who else is behind the bar');
  });

  test("but not watch somebody else's", async () => {
    const res = await request(`/api/orders?eventId=${bruno.eventId}`, {
      headers: asAccount(ana.host),
    });
    assert.equal(res.status, 404, 'and the id should not confirm the party exists');
  });
});

describe('what Admin may do', () => {
  test('open any bar without being invited to it', async () => {
    // "Admin can view and manage all hosts" — no join code, no membership.
    const res = await request(`/api/events/${bruno.eventId}/bar`, {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', ...asAccount(dan) },
    });
    assert.equal(res.status, 200);
  });

  test('and see every party, where a host sees only their own', async () => {
    const all = await okJson<{ events: { id: string }[] }>(
      await request('/api/events', { headers: asAccount(dan) }),
      "admin's list",
    );
    const ids = all.events.map((e) => e.id);
    assert.ok(ids.includes(ana.eventId) && ids.includes(bruno.eventId));

    const hers = await okJson<{ events: { id: string }[] }>(
      await request('/api/events', { headers: asAccount(ana.host) }),
      "ana's list",
    );
    assert.deepEqual(
      hers.events.map((e) => e.id),
      [ana.eventId],
    );
  });
});
