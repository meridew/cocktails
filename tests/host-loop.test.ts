// @vitest-environment node
/**
 * The whole loop, as a host actually walks it:
 *
 *   sign up → verify → create a party → open its bar → guests order at *that* party
 *
 * Before this existed the pieces were all present and none of them joined up: an
 * account led nowhere, an event could only be the singleton created at boot, and a
 * guest's order went to whichever event was live — so with two parties running,
 * people ordered at the wrong bar and nothing said so.
 *
 * That last point is why this suite exists alongside `tenancy.test.ts`. That one
 * proves two hosts can't *see* each other's data, but it builds each host in turn,
 * so only one event is ever live and the guest side is never exercised. Here both
 * parties are live at the same time, which is the case that used to be wrong.
 *
 * Node rather than jsdom: Better Auth signs tokens with `jose`, and jsdom's
 * `Uint8Array` is a different realm. See `tests/accounts.test.ts`.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { memorySender, setEmailSender } from '$lib/server/email';
import { resetAccounts } from '$lib/server/accounts';

const mail = memorySender();

interface Party {
  cookie: string;
  eventId: string;
  barToken: string;
}

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

/** Follow the verification link out of the most recent message. */
async function verifyLatest(): Promise<void> {
  const last = mail.sent.at(-1);
  assert.ok(last, 'no verification email was sent');
  const link = last.text.match(/https?:\/\/\S+/);
  assert.ok(link, 'no link in the verification email');
  const url = new URL(link[0]);
  const res = await request(url.pathname + url.search);
  assert.ok(res.status < 400, `verification failed: ${res.status}`);
}

/** A host who has signed up, verified, made a party and opened its bar. */
async function host(label: string): Promise<Party> {
  const creds = { name: label, email: `${label}@example.com`, password: `${label}-password-123` };

  await okJson(await request('/api/account/sign-up/email', send('POST', creds)), 'sign up');
  await verifyLatest();

  const signIn = await request(
    '/api/account/sign-in/email',
    send('POST', { email: creds.email, password: creds.password }),
  );
  assert.equal(signIn.status, 200, 'sign in');
  // Better Auth authenticates by cookie; carry it exactly as a browser would.
  const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(cookie, 'sign-in should have set a session cookie');

  const created = await request('/api/events', {
    ...send('POST', { name: `${label}'s party` }),
    headers: { 'Content-Type': 'application/json', cookie },
  });
  const { event } = await okJson<{ event: { id: string; hostUserId: string } }>(
    created,
    'create event',
  );
  assert.ok(event.hostUserId, 'a host-created event must have an owner');

  const bar = await request(`/api/events/${event.id}/bar`, {
    ...send('POST', {}),
    headers: { 'Content-Type': 'application/json', cookie },
  });
  const { token } = await okJson<{ token: string }>(bar, 'open bar');

  return { cookie, eventId: event.id, barToken: token };
}

/** A guest orders at a named party. */
async function order(eventId: string, who: string): Promise<string> {
  const res = await request(
    '/api/orders',
    send('POST', { eventId, name: who, items: [{ name: 'Mojito', qty: 1 }] }),
  );
  return (await okJson<{ id: string }>(res, `order for ${who}`)).id;
}

/** The queue a bar session can see. */
async function queue(token: string): Promise<{ id: string; name: string }[]> {
  const res = await request('/api/orders', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { orders: { id: string; name: string }[] }).orders;
}

let ana: Party;
let bruno: Party;

beforeAll(async () => {
  setEmailSender(mail);
  resetAccounts();
  ana = await host('ana');
  bruno = await host('bruno');
});

describe('a host can go from signing up to a working bar', () => {
  test('their event is owned by them and their bar session works', () => {
    assert.notEqual(ana.eventId, bruno.eventId);
    assert.ok(ana.barToken && bruno.barToken);
  });

  test('the bar starts empty', async () => {
    assert.deepEqual(await queue(ana.barToken), []);
  });
});

describe('two parties running at the same time', () => {
  test("each host sees only their own guests' drinks", async () => {
    // Both events are live simultaneously — the case the older suite cannot set up,
    // and the one where "whichever event is live" used to send guests astray.
    const forAna = await order(ana.eventId, 'ana guest');
    const forBruno = await order(bruno.eventId, 'bruno guest');

    const anaQueue = await queue(ana.barToken);
    const brunoQueue = await queue(bruno.barToken);

    assert.deepEqual(
      anaQueue.map((o) => o.id),
      [forAna],
      "ana's bar should hold exactly her guest's drink",
    );
    assert.deepEqual(
      brunoQueue.map((o) => o.id),
      [forBruno],
      "bruno's bar should hold exactly his guest's drink",
    );
  });

  test('ordering at a party that does not exist is refused', async () => {
    const res = await request(
      '/api/orders',
      send('POST', { eventId: 'nope', name: 'Lost', items: [{ name: 'Wine', qty: 1 }] }),
    );
    assert.equal(res.status, 404, 'an unknown party must not silently become the live one');
  });

  test('a host cannot open the bar at a party they do not work', async () => {
    const res = await request(`/api/events/${bruno.eventId}/bar`, {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', cookie: ana.cookie },
    });
    assert.equal(res.status, 404, 'and the id should not confirm the party exists');
  });

  test('creating an event needs an account, not a bar session', async () => {
    const anonymous = await request('/api/events', send('POST', { name: 'Nobody' }));
    assert.equal(anonymous.status, 401);

    const withBarToken = await request('/api/events', {
      ...send('POST', { name: 'Wrong credential' }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ana.barToken}` },
    });
    assert.equal(withBarToken.status, 401, 'a bar session is not an account');
  });
});
