/**
 * The keypad, at the HTTP boundary.
 *
 * **This file used to be about a secret in the environment.** `STAFF_PIN` was frozen
 * into `config` at import, so the whole thing was built around setting env before any
 * `$lib/server` module could load, and around `seedStaff()` existing to give the PIN
 * an account to be. All of that is gone: a PIN belongs to an account and is set
 * through the app, so this is an ordinary endpoint test again.
 *
 * The mechanics — hashing, per-IP and per-account throttling — live in
 * `auth.test.ts`. What matters here is what the *endpoint* gives away, which is the
 * only part an attacker can actually see.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { PIN_LENGTH, isValidPin } from '$lib/shared';
import { request, send } from './app';
import { setAccountPin } from '$lib/server/auth';
import { barToken, partyFor, person, useMemoryEmail, type Account } from './fixtures/people';

const PIN = '135790';

let dan: Account;
let noPin: Account;
let eventId = '';

/** Distinct IPs, so one test's throttle doesn't leak into the next. */
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}`;

const tryPin = (userId: string, pin: string, ip = freshIp()) =>
  request('/api/auth/pin', send('POST', { userId, pin, eventId }, { 'cf-connecting-ip': ip }));

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('pin-dan', 'admin');
  noPin = await person('pin-nobody', 'admin');
  eventId = partyFor(dan.id, 'PIN party');
  // Both need a shift at the party: the keypad returns you to a bar, so there has
  // to be one to return to.
  await barToken(dan, eventId);
  await barToken(noPin, eventId);
  await setAccountPin(dan.id, PIN);
});

describe('isValidPin', () => {
  test('requires exactly the configured number of digits', () => {
    assert.ok(isValidPin('0'.repeat(PIN_LENGTH)));
    assert.ok(!isValidPin('0'.repeat(PIN_LENGTH - 1)));
    assert.ok(!isValidPin('0'.repeat(PIN_LENGTH + 1)));
  });

  test('rejects anything that isn’t digits', () => {
    for (const bad of ['12 456', '12345a', '+12345', '', null, 123456, ' 123456 ']) {
      assert.ok(!isValidPin(bad), String(bad));
    }
  });
});

describe('signing in with it', () => {
  test('the right PIN opens the bar', async () => {
    const res = await tryPin(dan.id, PIN);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; token: string };
    assert.equal(body.ok, true);
    assert.ok(body.token, 'a session token comes back');
  });

  test('the token it issues really works', async () => {
    const { token } = (await (await tryPin(dan.id, PIN)).json()) as { token: string };
    const res = await request('/api/orders', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
  });

  test('a wrong PIN, an unset PIN and a malformed one are indistinguishable', async () => {
    // The whole point: nothing here says whether an account *has* a keypad, which
    // would otherwise be a way to find out who does.
    const wrong = await tryPin(dan.id, '000000');
    const unset = await tryPin(noPin.id, '000000');
    const malformed = await tryPin(dan.id, 'nope');
    for (const [what, res] of [
      ['a wrong PIN', wrong],
      ['an account with no PIN', unset],
      ['a malformed PIN', malformed],
    ] as const) {
      assert.equal(res.status, 401, what);
      assert.deepEqual(await res.json(), { ok: false, error: 'wrong PIN' }, what);
    }
  });

  test('it will not sign you in to a party you are not working', async () => {
    const elsewhere = partyFor(dan.id, 'A party Dan has no shift at');
    const res = await request(
      '/api/auth/pin',
      send('POST', { userId: dan.id, pin: PIN, eventId: elsewhere }),
    );
    assert.equal(res.status, 401, 'the PIN proves who you are, not that you have a shift');
  });

  test('it needs to be told whose keypad, and which bar', async () => {
    for (const body of [{ pin: PIN }, { pin: PIN, userId: dan.id }, { pin: PIN, eventId }]) {
      const res = await request('/api/auth/pin', send('POST', body));
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });
});

describe('throttling', () => {
  test('one account under attack is locked, and nobody else is', async () => {
    const ip = freshIp();
    let blocked = false;
    for (let i = 0; i < 15 && !blocked; i++) {
      if ((await tryPin(dan.id, '000000', ip)).status === 429) blocked = true;
    }
    assert.ok(blocked, 'a 10^6 keyspace needs a brake');

    // A different account from a different address carries on — the reason the
    // second layer is per-account rather than global.
    const bystander = await tryPin(noPin.id, '000000', freshIp());
    assert.notEqual(bystander.status, 429, 'one victim must not shut every keypad');
  });
});
