/**
 * HTTP surface, driven in-process via `request()` — no port, no network.
 *
 * `seedStaff()` lives in server.ts, so nothing is seeded here: each test creates
 * the accounts it needs, which keeps setup explicit.
 *
 * Push is inert: `push.ts` computes `enabled` from config.vapid at import, and the
 * test env has no VAPID keys, so the `void pushTo*()` calls in the routes are
 * no-ops. Do not add VAPID_* to the test env — it would make these tests hit the
 * network.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { LIMITS, type Actor } from '$lib/shared';
import { request } from './app';
import {
  admittedDevice,
  barToken,
  partyFor,
  person,
  useMemoryEmail,
  type Account,
} from './fixtures/people';

let dan: Account;
let eventId = '';
let token = '';

const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const json = (body: unknown, headers: Record<string, string> = {}) => send('POST', body, headers);
const patch = (body: unknown, headers: Record<string, string> = {}) => send('PATCH', body, headers);
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

/**
 * Place an order and return its id.
 *
 * The device defaults to one the bar has already admitted, because every test below
 * is about something else — validation, throttling, the status chain — and an
 * un-admitted guest's drink never reaches the queue those tests then read.
 */
async function placeOrder(name = 'Guest', deviceId = admittedDevice(eventId)): Promise<string> {
  const res = await request(
    '/api/orders',
    json({ name, eventId, items: [{ name: 'Mojito', qty: 1 }], deviceId }),
  );
  assert.equal(res.status, 200);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('routes-dan', 'admin');
  eventId = partyFor(dan.id, 'Routes party');
  token = await barToken(dan, eventId);
  assert.ok(token);
});

describe('the test dispatcher covers every endpoint', () => {
  test('no +server.ts on disk is missing from tests/app.ts', async () => {
    // tests/app.ts resolves against an explicit table rather than SvelteKit's own
    // router. That's fine for driving handlers, but it means a new endpoint could
    // be added and simply never tested. This makes that a failure.
    const { readdirSync } = await import('node:fs');
    const { join, relative, sep } = await import('node:path');
    const { ROUTES } = await import('./app');

    const root = join(process.cwd(), 'src', 'routes', 'api');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === '+server.ts') {
          found.push('/api/' + relative(root, dir).split(sep).join('/'));
        }
      }
    };
    walk(root);

    const known = new Set(Object.keys(ROUTES));
    const missing = found.filter((id) => !known.has(id));
    assert.deepEqual(missing, [], 'endpoints exist that no test can reach');
    // And nothing in the table points at a route that has been deleted.
    const stale = [...known].filter((id) => !found.includes(id));
    assert.deepEqual(stale, [], 'dispatcher lists routes that no longer exist');
  });
});

describe('public routes', () => {
  test('GET /api/health', async () => {
    const res = await request('/api/health');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; now: number };
    assert.equal(body.ok, true);
    assert.equal(typeof body.now, 'number');
  });

  test('GET /api/push/key reports push disabled without VAPID keys', async () => {
    const res = await request('/api/push/key');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, enabled: false, key: '' });
  });
});

describe('staff guard', () => {
  // `/api/auth/logout` and `/api/auth/me` have left this list on purpose. Logging
  // out asks for nothing — refusing an already-dead token would strand a client
  // holding it — and "who am I" answers "nobody" rather than 401, because the
  // signed-out front door asks it too.
  const guarded: [string, RequestInit][] = [
    ['/api/orders', { method: 'GET' }],
    ['/api/orders/x', { method: 'PATCH' }],
    ['/api/orders/x', { method: 'DELETE' }],
    ['/api/orders/clear', { method: 'POST' }],
  ];

  test('every staff route rejects a missing, garbage, or non-bearer token', async () => {
    for (const [path, init] of guarded) {
      const attempts: Record<string, string>[] = [
        {},
        { Authorization: 'Bearer garbage' },
        { Authorization: 'Basic x' },
      ];
      for (const headers of attempts) {
        const res = await request(path, { ...init, headers });
        assert.equal(res.status, 401, `${init.method} ${path} with ${JSON.stringify(headers)}`);
      }
    }
  });

  test('the bearer scheme is case-insensitive', async () => {
    const res = await request('/api/auth/me', {
      headers: { Authorization: `bearer ${token}` },
    });
    assert.equal(res.status, 200);
  });
});

/**
 * `POST /api/auth/login` used to be tested here — wrong password, malformed body,
 * per-IP throttle. The endpoint is deleted: signing in with an email and a password
 * is an account's job now, and the throttle that guarded it went with it. Its
 * replacement, the per-account keypad, is covered in `auth.test.ts`.
 */
describe('who am I', () => {
  test('answers with an actor, and never 401s', async () => {
    const anon = await request('/api/auth/me');
    assert.equal(anon.status, 200, '"nobody" is a real answer, not an error');
    const empty = (await anon.json()) as { ok: boolean; actor: Actor };
    assert.equal(empty.actor.account, null);
    assert.equal(empty.actor.party, null);
  });

  test('a bar session speaks for the account behind it', async () => {
    const scoped = await barToken(dan, eventId);
    const me = await request('/api/auth/me', { headers: auth(scoped) });
    assert.equal(me.status, 200);
    const body = (await me.json()) as { ok: boolean; actor: Actor };
    assert.equal(body.ok, true);
    assert.equal(body.actor.account?.id, dan.id, 'the staff row names the account');
    assert.equal(body.actor.account?.role, 'admin');

    const out = await request('/api/auth/logout', { method: 'POST', headers: auth(scoped) });
    assert.equal(out.status, 200);

    const after = await request('/api/auth/me', { headers: auth(scoped) });
    const gone = (await after.json()) as { actor: Actor };
    assert.equal(gone.actor.account, null, 'the token should be dead after logout');
  });
});

describe('POST /api/orders', () => {
  test('rejects incomplete or malformed orders', async () => {
    const cases: unknown[] = [
      {},
      { name: 'Dan', items: [] },
      { name: '   ', items: [{ name: 'Mojito' }] },
      { name: 'Dan', items: 'nope' },
      { name: 'Dan', items: [{ qty: 2 }] }, // no item name → dropped → empty
    ];
    for (const body of cases) {
      const res = await request('/api/orders', json(body));
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });

  test('accepts a valid order as pending', async () => {
    const res = await request(
      '/api/orders',
      json({ name: 'Dan', eventId, items: [{ name: 'Wine' }], deviceId: admittedDevice(eventId) }),
    );
    assert.equal(res.status, 200);
    const { order } = (await res.json()) as {
      order: { status: string; items: { name: string; qty: number }[] };
    };
    assert.equal(order.status, 'pending');
    assert.deepEqual(
      order.items.map(({ name, qty }) => ({ name, qty })),
      [{ name: 'Wine', qty: 1 }],
      'a missing qty defaults to 1',
    );
    assert.ok(!('unit' in order.items[0]!), 'private unit snapshots must not reach guests');
  });

  test('sanitises strings through the boundary', async () => {
    // NUL and DEL either side of the name, built from char codes rather than
    // escape sequences: the literal form is invisible in a diff, and three
    // separate tools mangled it on the way into this file.
    const dirty = `${String.fromCharCode(0)}Da${String.fromCharCode(127)}n `;
    const res = await request(
      '/api/orders',
      json({
        name: dirty,
        eventId,
        items: [{ name: 'Mojito' }],
        deviceId: admittedDevice(eventId),
      }),
    );
    const { order } = (await res.json()) as { order: { name: string } };
    assert.equal(order.name, 'Dan', 'control characters should be stripped and the value trimmed');

    const long = await request(
      '/api/orders',
      json({
        name: 'x'.repeat(200),
        eventId,
        items: [{ name: 'Mojito' }],
        deviceId: admittedDevice(eventId),
      }),
    );
    const { order: capped } = (await long.json()) as { order: { name: string } };
    assert.equal(capped.name.length, LIMITS.maxFieldLen, 'over-long names are capped');
  });

  test('coerces item quantities', async () => {
    const res = await request(
      '/api/orders',
      json({
        name: 'Coerce',
        eventId,
        items: [
          { name: 'Wine', qty: 0 },
          { name: 'Mojito', qty: 'abc' },
          { name: 'Margarita', qty: 1000 },
          { name: 'Old Fashioned', qty: 2.7 },
          null,
        ],
        deviceId: admittedDevice(eventId),
      }),
    );
    const { order } = (await res.json()) as { order: { items: { name: string; qty: number }[] } };
    assert.deepEqual(
      order.items.map(({ name, qty }) => ({ name, qty })),
      [
        { name: 'Wine', qty: 1 },
        { name: 'Mojito', qty: 1 },
        { name: 'Margarita', qty: LIMITS.maxQty },
        { name: 'Old Fashioned', qty: 2 },
      ],
    );
  });

  test('caps the number of items per order', async () => {
    const menu = ['Margarita', 'Mojito', 'Moscow Mule', 'Old Fashioned', 'Wine'];
    const items = Array.from({ length: LIMITS.maxItemsPerOrder + 10 }, (_, i) => ({
      name: menu[i % menu.length],
      qty: 1,
    }));
    const res = await request(
      '/api/orders',
      json({ name: 'Many', eventId, items, deviceId: admittedDevice(eventId) }),
    );
    const { order } = (await res.json()) as { order: { items: unknown[] } };
    assert.equal(order.items.length, LIMITS.maxItemsPerOrder);
  });

  test('throttles a flood from one client', async () => {
    // Unthrottled, a loop here spams the bartender with pushes and eventually
    // evicts real orders once the cap is reached.
    const ip = '198.51.100.42';
    let sawThrottle = false;
    for (let i = 0; i < 40; i++) {
      const res = await request(
        '/api/orders',
        json(
          { name: `Flood${i}`, eventId, items: [{ name: 'Mojito' }] },
          { 'x-forwarded-for': ip },
        ),
      );
      if (res.status === 429) {
        sawThrottle = true;
        break;
      }
    }
    assert.ok(sawThrottle, 'a sustained flood from one IP should be throttled');

    const other = await request(
      '/api/orders',
      json(
        {
          name: 'Innocent',
          eventId,
          items: [{ name: 'Mojito' }],
          deviceId: admittedDevice(eventId),
        },
        { 'x-forwarded-for': '198.51.100.43' },
      ),
    );
    assert.equal(other.status, 200, 'a different client must not be caught in the throttle');
  });

  test('rejects an oversized body', async () => {
    const res = await request(
      '/api/orders',
      json({ name: 'Big', items: [{ name: 'Mojito' }], pad: 'A'.repeat(300_000) }),
    );
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { ok: false, error: 'payload too large' });
  });
});

describe('staff order management', () => {
  test('GET /api/orders lists the queue', async () => {
    await placeOrder('Listed');
    const res = await request('/api/orders', { headers: auth() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; orders: { name: string }[] };
    assert.equal(body.ok, true);
    assert.ok(body.orders.some((o) => o.name === 'Listed'));
  });

  test('PATCH walks the full status chain', async () => {
    const id = await placeOrder('Chain');
    for (const status of ['making', 'serving', 'done']) {
      const res = await request(`/api/orders/${id}`, patch({ status }, auth()));
      assert.equal(res.status, 200, status);
      const { order } = (await res.json()) as { order: { status: string } };
      assert.equal(order.status, status);
    }
  });

  test('PATCH rejects a bad status and an unknown id', async () => {
    const id = await placeOrder('Bad');
    for (const status of ['cooking', null, 42]) {
      const res = await request(`/api/orders/${id}`, patch({ status }, auth()));
      assert.equal(res.status, 422, JSON.stringify(status));
    }
    const missing = await request('/api/orders/deadbeef', patch({ status: 'making' }, auth()));
    assert.equal(missing.status, 404);
  });

  test('DELETE removes an order, and 404s when it is already gone', async () => {
    const id = await placeOrder('Doomed');
    const res = await request(`/api/orders/${id}`, { method: 'DELETE', headers: auth() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    // Deleting twice (two bartenders, or a double tap) must report "not found"
    // rather than `200 {ok:false}`, which rendered "Something went wrong (HTTP 200)."
    const again = await request(`/api/orders/${id}`, { method: 'DELETE', headers: auth() });
    assert.equal(again.status, 404);
    assert.deepEqual(await again.json(), { ok: false, error: 'not found' });
  });

  test('clear removes done orders, or all of them', async () => {
    await request('/api/orders/clear', json({ which: 'all' }, auth()));

    const done = await placeOrder('WillBeDone');
    await request(`/api/orders/${done}`, patch({ status: 'done' }, auth()));
    await placeOrder('StaysPending');

    // An unrecognised `which` is treated as 'done'.
    await request('/api/orders/clear', json({ which: 'nonsense' }, auth()));
    const left = await request('/api/orders', { headers: auth() });
    const { orders } = (await left.json()) as { orders: { name: string }[] };
    assert.deepEqual(
      orders.map((o) => o.name),
      ['StaysPending'],
    );

    await request('/api/orders/clear', json({ which: 'all' }, auth()));
    const empty = await request('/api/orders', { headers: auth() });
    assert.equal(((await empty.json()) as { orders: unknown[] }).orders.length, 0);
  });
});

describe('POST /api/subscriptions', () => {
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub',
    keys: { p256dh: 'p', auth: 'a' },
  };

  test('rejects an incomplete or unsafe subscription', async () => {
    const keys = { p256dh: 'p', auth: 'a' };
    const cases: [string, unknown][] = [
      ['no deviceId', { role: 'guest', subscription: sub }],
      ['no subscription', { deviceId: 'd', role: 'guest' }],
      ['null subscription', { deviceId: 'd', role: 'guest', subscription: null }],
      [
        'missing keys.auth',
        { deviceId: 'd', subscription: { endpoint: sub.endpoint, keys: { p256dh: 'p' } } },
      ],
      [
        // web-push needs p256dh to encrypt; without it the row would be stored and
        // then fail silently at send time.
        'missing keys.p256dh',
        { deviceId: 'd', subscription: { endpoint: sub.endpoint, keys: { auth: 'a' } } },
      ],
      ['no keys at all', { deviceId: 'd', subscription: { endpoint: sub.endpoint } }],
      // SSRF: the endpoint becomes a request target, so it must be a push service.
      [
        'internal address',
        { deviceId: 'd', subscription: { endpoint: 'https://192.168.1.1/x', keys } },
      ],
      [
        'arbitrary host',
        { deviceId: 'd', subscription: { endpoint: 'https://evil.example/x', keys } },
      ],
      [
        'plain http',
        { deviceId: 'd', subscription: { endpoint: 'http://fcm.googleapis.com/x', keys } },
      ],
    ];
    for (const [label, body] of cases) {
      const res = await request('/api/subscriptions', json(body));
      assert.equal(res.status, 422, label);
    }
  });

  test('downgrades an unauthenticated bartender registration to guest', async () => {
    const res = await request(
      '/api/subscriptions',
      json({ deviceId: 'dev-anon', role: 'bartender', subscription: sub }),
    );
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { role: string }).role, 'guest');
  });

  test('an expired or garbage token is also downgraded', async () => {
    const res = await request(
      '/api/subscriptions',
      json(
        { deviceId: 'dev-badtoken', role: 'bartender', subscription: sub },
        { Authorization: 'Bearer not-a-real-token' },
      ),
    );
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { role: string }).role, 'guest');
  });

  test('honours a bartender registration from authenticated staff', async () => {
    const res = await request(
      '/api/subscriptions',
      json({ deviceId: 'dev-staff', role: 'bartender', subscription: sub }, auth()),
    );
    assert.equal(res.status, 200);
    const registered = (await res.json()) as {
      role: string;
      eventId: string;
      managementToken: string;
    };
    assert.equal(registered.role, 'bartender');
    assert.equal(registered.eventId, eventId, 'the party comes from the authenticated session');
    assert.ok(registered.managementToken.length >= 40);
  });
});

describe('DELETE /api/subscriptions', () => {
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/off',
    keys: { p256dh: 'p', auth: 'a' },
  };

  // Its own IPs: the write throttle is per-IP, and sharing one with the rest of the
  // file would make these pass or fail depending on how much came before them.
  let ipCounter = 0;
  const ip = () => ({ 'cf-connecting-ip': `198.51.100.${++ipCounter % 250}` });

  const subscribe = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    request('/api/subscriptions', json(body, { ...ip(), ...headers }));

  const unsubscribe = (endpointId: unknown, managementToken: unknown) =>
    request('/api/subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...ip() },
      body: JSON.stringify({ endpointId, managementToken }),
    });

  test('turning notifications off leaves nothing to send to', async () => {
    // "Off" is the absence of a subscription, not a preference consulted before
    // sending: Web Push is userVisibleOnly, so anything delivered *must* be shown.
    const created = await subscribe({ deviceId: 'dev-off', subscription: sub });
    const registration = (await created.json()) as { endpointId: string; managementToken: string };
    assert.equal(
      (await unsubscribe(registration.endpointId, registration.managementToken)).status,
      200,
    );
    const status = await request(`/api/subscriptions?endpointId=${registration.endpointId}`, {
      headers: { 'x-push-management-token': registration.managementToken },
    });
    assert.equal(status.status, 403, 'the capability dies with its endpoint');
  });

  test('one endpoint capability covers every audience on that endpoint', async () => {
    await subscribe({ deviceId: 'dev-both', subscription: sub });
    const bartender = await subscribe(
      {
        deviceId: 'dev-both',
        role: 'bartender',
        subscription: sub,
      },
      auth(),
    );
    const registration = (await bartender.json()) as {
      endpointId: string;
      managementToken: string;
    };
    assert.equal(
      (await unsubscribe(registration.endpointId, registration.managementToken)).status,
      200,
    );
  });

  test('a capability cannot remove another endpoint', async () => {
    const keep = await subscribe({ deviceId: 'dev-keep', subscription: sub });
    const remove = await subscribe({
      deviceId: 'dev-remove',
      subscription: { ...sub, endpoint: `${sub.endpoint}-other` },
    });
    const kept = (await keep.json()) as { endpointId: string; managementToken: string };
    const removed = (await remove.json()) as { endpointId: string; managementToken: string };
    assert.equal((await unsubscribe(removed.endpointId, kept.managementToken)).status, 403);
    const status = await request(`/api/subscriptions?endpointId=${kept.endpointId}`, {
      headers: { 'x-push-management-token': kept.managementToken },
    });
    assert.equal(status.status, 200);
  });

  test('requires an endpoint capability', async () => {
    assert.equal((await unsubscribe(undefined, undefined)).status, 403);
  });
});
