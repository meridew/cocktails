/**
 * HTTP surface, driven in-process via `app.request()` — no port, no network.
 *
 * `seedStaff()` lives in server.ts, so nothing is seeded here: each test creates
 * the accounts it needs, which keeps setup explicit.
 *
 * Push is inert: `push.ts` computes `enabled` from config.vapid at import, and the
 * test env has no VAPID keys, so the `void pushTo*()` calls in the routes are
 * no-ops. Do not add VAPID_* to the test env — it would make these tests hit the
 * network.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '@cocktails/shared';
import { app } from '../src/app.ts';
import { hashPassword } from '../src/auth.ts';
import { createStaff, genId } from '../src/db.ts';

const STAFF = { email: 'routes@local', password: 'routes-pw' };
let token = '';

const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const json = (body: unknown, headers: Record<string, string> = {}) => send('POST', body, headers);
const patch = (body: unknown, headers: Record<string, string> = {}) => send('PATCH', body, headers);
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

/** Place an order and return its id. */
async function placeOrder(name = 'Guest', deviceId?: string): Promise<string> {
  const res = await app.request(
    '/api/orders',
    json({ name, items: [{ name: 'Mojito', qty: 1 }], deviceId }),
  );
  assert.equal(res.status, 200);
  return ((await res.json()) as { id: string }).id;
}

before(async () => {
  createStaff({
    id: genId(),
    email: STAFF.email,
    passwordHash: await hashPassword(STAFF.password),
    role: 'bartender',
  });
  const res = await app.request('/api/auth/login', json(STAFF));
  assert.equal(res.status, 200, 'fixture login should succeed');
  token = ((await res.json()) as { token: string }).token;
  assert.ok(token);
});

describe('public routes', () => {
  test('GET /api/health', async () => {
    const res = await app.request('/api/health');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; now: number };
    assert.equal(body.ok, true);
    assert.equal(typeof body.now, 'number');
  });

  test('GET /api/push/key reports push disabled without VAPID keys', async () => {
    const res = await app.request('/api/push/key');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, enabled: false, key: '' });
  });
});

describe('staff guard', () => {
  const guarded: [string, RequestInit][] = [
    ['/api/orders', { method: 'GET' }],
    ['/api/orders/x', { method: 'PATCH' }],
    ['/api/orders/x', { method: 'DELETE' }],
    ['/api/orders/clear', { method: 'POST' }],
    ['/api/auth/logout', { method: 'POST' }],
    ['/api/auth/me', { method: 'GET' }],
  ];

  test('every staff route rejects a missing, garbage, or non-bearer token', async () => {
    for (const [path, init] of guarded) {
      for (const headers of [
        {},
        { Authorization: 'Bearer garbage' },
        { Authorization: 'Basic x' },
      ]) {
        const res = await app.request(path, { ...init, headers });
        assert.equal(res.status, 401, `${init.method} ${path} with ${JSON.stringify(headers)}`);
      }
    }
  });

  test('the bearer scheme is case-insensitive', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `bearer ${token}` },
    });
    assert.equal(res.status, 200);
  });
});

describe('auth routes', () => {
  test('login rejects a wrong password and a non-JSON body without a 500', async () => {
    const bad = await app.request('/api/auth/login', json({ ...STAFF, password: 'nope' }));
    assert.equal(bad.status, 401);

    const malformed = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.equal(malformed.status, 401, 'a malformed body must not surface as a 500');
  });

  test('me returns the signed-in staff member, then logout invalidates the token', async () => {
    const login = await app.request('/api/auth/login', json(STAFF));
    const { token: scoped } = (await login.json()) as { token: string };

    const me = await app.request('/api/auth/me', { headers: auth(scoped) });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()) as unknown, {
      ok: true,
      staff: { email: STAFF.email, role: 'bartender' },
    });

    const out = await app.request('/api/auth/logout', { method: 'POST', headers: auth(scoped) });
    assert.equal(out.status, 200);

    const after = await app.request('/api/auth/me', { headers: auth(scoped) });
    assert.equal(after.status, 401, 'the token should be dead after logout');
  });

  test('throttles after 10 failures, per IP', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        '/api/auth/login',
        json({ ...STAFF, password: 'wrong' }, { 'x-forwarded-for': ip }),
      );
      assert.equal(res.status, 401, `attempt ${i + 1} should be 401, not throttled yet`);
    }
    const blocked = await app.request(
      '/api/auth/login',
      json({ ...STAFF, password: 'wrong' }, { 'x-forwarded-for': ip }),
    );
    assert.equal(blocked.status, 429, 'the 11th attempt should be throttled');

    const other = await app.request(
      '/api/auth/login',
      json({ ...STAFF, password: 'wrong' }, { 'x-forwarded-for': '203.0.113.8' }),
    );
    assert.equal(other.status, 401, 'a different IP must not be throttled');
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
      const res = await app.request('/api/orders', json(body));
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });

  test('accepts a valid order as pending', async () => {
    const res = await app.request('/api/orders', json({ name: 'Dan', items: [{ name: 'Wine' }] }));
    assert.equal(res.status, 200);
    const { order } = (await res.json()) as { order: { status: string; items: unknown[] } };
    assert.equal(order.status, 'pending');
    assert.deepEqual(order.items, [{ name: 'Wine', qty: 1 }], 'a missing qty defaults to 1');
  });

  test('sanitises strings through the boundary', async () => {
    const res = await app.request(
      '/api/orders',
      json({ name: '\u0000Da\u007fn ', items: [{ name: 'Mojito' }] }),
    );
    const { order } = (await res.json()) as { order: { name: string } };
    assert.equal(order.name, 'Dan', 'control characters should be stripped and the value trimmed');

    const long = await app.request(
      '/api/orders',
      json({ name: 'x'.repeat(200), items: [{ name: 'Mojito' }] }),
    );
    const { order: capped } = (await long.json()) as { order: { name: string } };
    assert.equal(capped.name.length, LIMITS.maxFieldLen, 'over-long names are capped');
  });

  test('coerces item quantities', async () => {
    const res = await app.request(
      '/api/orders',
      json({
        name: 'Coerce',
        items: [
          { name: 'Zero', qty: 0 },
          { name: 'NaN', qty: 'abc' },
          { name: 'Huge', qty: 1000 },
          { name: 'Fraction', qty: 2.7 },
          null,
        ],
      }),
    );
    const { order } = (await res.json()) as { order: { items: { name: string; qty: number }[] } };
    assert.deepEqual(order.items, [
      { name: 'Zero', qty: 1 },
      { name: 'NaN', qty: 1 },
      { name: 'Huge', qty: LIMITS.maxQty },
      { name: 'Fraction', qty: 2 },
    ]);
  });

  test('caps the number of items per order', async () => {
    const items = Array.from({ length: LIMITS.maxItemsPerOrder + 10 }, (_, i) => ({
      name: `Drink ${i}`,
      qty: 1,
    }));
    const res = await app.request('/api/orders', json({ name: 'Many', items }));
    const { order } = (await res.json()) as { order: { items: unknown[] } };
    assert.equal(order.items.length, LIMITS.maxItemsPerOrder);
  });

  test('throttles a flood from one client', async () => {
    // Unthrottled, a loop here spams the bartender with pushes and eventually
    // evicts real orders once the cap is reached.
    const ip = '198.51.100.42';
    let sawThrottle = false;
    for (let i = 0; i < 40; i++) {
      const res = await app.request(
        '/api/orders',
        json({ name: `Flood${i}`, items: [{ name: 'Mojito' }] }, { 'x-forwarded-for': ip }),
      );
      if (res.status === 429) {
        sawThrottle = true;
        break;
      }
    }
    assert.ok(sawThrottle, 'a sustained flood from one IP should be throttled');

    const other = await app.request(
      '/api/orders',
      json(
        { name: 'Innocent', items: [{ name: 'Mojito' }] },
        { 'x-forwarded-for': '198.51.100.43' },
      ),
    );
    assert.equal(other.status, 200, 'a different client must not be caught in the throttle');
  });

  test('rejects an oversized body', async () => {
    const res = await app.request(
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
    const res = await app.request('/api/orders', { headers: auth() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; orders: { name: string }[] };
    assert.equal(body.ok, true);
    assert.ok(body.orders.some((o) => o.name === 'Listed'));
  });

  test('PATCH walks the full status chain', async () => {
    const id = await placeOrder('Chain');
    for (const status of ['making', 'serving', 'done']) {
      const res = await app.request(`/api/orders/${id}`, patch({ status }, auth()));
      assert.equal(res.status, 200, status);
      const { order } = (await res.json()) as { order: { status: string } };
      assert.equal(order.status, status);
    }
  });

  test('PATCH rejects a bad status and an unknown id', async () => {
    const id = await placeOrder('Bad');
    for (const status of ['cooking', null, 42]) {
      const res = await app.request(`/api/orders/${id}`, patch({ status }, auth()));
      assert.equal(res.status, 422, JSON.stringify(status));
    }
    const missing = await app.request('/api/orders/deadbeef', patch({ status: 'making' }, auth()));
    assert.equal(missing.status, 404);
  });

  test('DELETE removes an order, and 404s when it is already gone', async () => {
    const id = await placeOrder('Doomed');
    const res = await app.request(`/api/orders/${id}`, { method: 'DELETE', headers: auth() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    // Deleting twice (two bartenders, or a double tap) must report "not found"
    // rather than `200 {ok:false}`, which rendered "Something went wrong (HTTP 200)."
    const again = await app.request(`/api/orders/${id}`, { method: 'DELETE', headers: auth() });
    assert.equal(again.status, 404);
    assert.deepEqual(await again.json(), { ok: false, error: 'not found' });
  });

  test('clear removes done orders, or all of them', async () => {
    await app.request('/api/orders/clear', json({ which: 'all' }, auth()));

    const done = await placeOrder('WillBeDone');
    await app.request(`/api/orders/${done}`, patch({ status: 'done' }, auth()));
    await placeOrder('StaysPending');

    // An unrecognised `which` is treated as 'done'.
    await app.request('/api/orders/clear', json({ which: 'nonsense' }, auth()));
    const left = await app.request('/api/orders', { headers: auth() });
    const { orders } = (await left.json()) as { orders: { name: string }[] };
    assert.deepEqual(
      orders.map((o) => o.name),
      ['StaysPending'],
    );

    await app.request('/api/orders/clear', json({ which: 'all' }, auth()));
    const empty = await app.request('/api/orders', { headers: auth() });
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
      const res = await app.request('/api/subscriptions', json(body));
      assert.equal(res.status, 422, label);
    }
  });

  test('downgrades an unauthenticated bartender registration to guest', async () => {
    const { subscriptionsForDevice } = await import('../src/db.ts');

    const res = await app.request(
      '/api/subscriptions',
      json({ deviceId: 'dev-anon', role: 'bartender', subscription: sub }),
    );
    assert.equal(res.status, 200);
    assert.equal(
      subscriptionsForDevice('dev-anon')[0]?.role,
      'guest',
      'anyone could otherwise enroll for the bar feed and see guests’ orders',
    );
  });

  test('an expired or garbage token is also downgraded', async () => {
    const { subscriptionsForDevice } = await import('../src/db.ts');
    const res = await app.request(
      '/api/subscriptions',
      json(
        { deviceId: 'dev-badtoken', role: 'bartender', subscription: sub },
        { Authorization: 'Bearer not-a-real-token' },
      ),
    );
    assert.equal(res.status, 200);
    assert.equal(subscriptionsForDevice('dev-badtoken')[0]?.role, 'guest');
  });

  test('honours a bartender registration from authenticated staff', async () => {
    const { subscriptionsForDevice } = await import('../src/db.ts');
    const res = await app.request(
      '/api/subscriptions',
      json({ deviceId: 'dev-staff', role: 'bartender', subscription: sub }, auth()),
    );
    assert.equal(res.status, 200);
    assert.equal(subscriptionsForDevice('dev-staff')[0]?.role, 'bartender');
  });
});
