/**
 * PIN sign-in.
 *
 * A 6-digit PIN is a small keyspace, so these tests are mostly about the things
 * that keep it safe: the shape check, the constant-length compare, the throttle
 * (per-IP *and* global), and the refusal to work at all when no PIN is configured.
 */
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { PIN_LENGTH, isValidPin, type Staff } from '$lib/shared';

/**
 * `config` freezes the PIN when it is first imported, and static imports are
 * hoisted above any code in this file — so nothing that reaches `$lib/server`
 * may be imported statically here, or the env below would be set too late to
 * matter. That includes ./app, which pulls in every route. (The pure
 * `resolveStaffPin` branches are covered in config.test.ts, which needs no env.)
 */
const PIN = '135790';
const EMAIL = 'pinbar@local';

let request: typeof import('./app').request;
let seedStaff: typeof import('$lib/server/auth').seedStaff;
const originalEnv = { ...process.env };

const send = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Distinct IPs, so one test's throttle doesn't leak into the next. */
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}`;
const from = (ip: string, body: unknown) => ({
  ...send(body),
  headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
});

const tryPin = (pin: string, ip = freshIp()) => request('/api/auth/pin', from(ip, { pin }));

beforeAll(async () => {
  process.env.STAFF_PIN = PIN;
  process.env.STAFF_EMAIL = EMAIL;
  process.env.STAFF_PASSWORD = 'a-long-real-password';
  ({ request } = await import('./app'));
  ({ seedStaff } = await import('$lib/server/auth'));
  await seedStaff(); // the PIN signs in as the seeded admin, so it must exist
});

afterAll(() => {
  process.env = originalEnv;
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

describe('POST /api/auth/pin', () => {
  test('the right PIN returns a session for the admin account', async () => {
    const res = await tryPin(PIN);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string; staff: Staff };
    assert.ok(body.token);
    assert.equal(body.staff.role, 'admin');
    assert.equal(body.staff.email, EMAIL);
  });

  test('the session it issues really works', async () => {
    const { token } = (await (await tryPin(PIN)).json()) as { token: string };
    const me = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    // Admin-only routes too — this is the account that approves helpers.
    const staff = await request('/api/staff', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(staff.status, 200);
  });

  test('a wrong PIN is 401 and issues nothing', async () => {
    const res = await tryPin('999999');
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; token?: string };
    assert.equal(body.ok, false);
    assert.equal(body.token, undefined);
  });

  test('malformed input is refused without leaking how it failed', async () => {
    const ip = freshIp();
    for (const pin of ['', '1', '12345', '1234567', 'abcdef', '12 456']) {
      const res = await request('/api/auth/pin', from(ip, { pin }));
      assert.equal(res.status, 401, pin);
    }
  });

  test('a missing or non-string pin field is refused, not crashed', async () => {
    for (const body of [{}, { pin: null }, { pin: 123456 }, { pin: ['1'] }, 'not json at all']) {
      const res = await request('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': freshIp() },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      assert.equal(res.status, 401, JSON.stringify(body));
    }
  });
});

describe('throttling', () => {
  beforeEach(async () => {
    // A success clears the counters for the IP and globally, which keeps these
    // cases independent of whatever the previous test spent.
    await tryPin(PIN);
  });

  test('repeated wrong PINs from one IP are locked out with 429', async () => {
    const ip = freshIp();
    let sawLockout = false;
    for (let i = 0; i < 15; i++) {
      const res = await tryPin('000001', ip);
      if (res.status === 429) {
        sawLockout = true;
        break;
      }
    }
    assert.ok(sawLockout, 'a 10^6 keyspace with no per-IP brake is brute-forceable');
  });

  test('the lockout blocks the correct PIN too, so it cannot be probed around', async () => {
    const ip = freshIp();
    for (let i = 0; i < 15; i++) await tryPin('000002', ip);
    const res = await tryPin(PIN, ip);
    assert.equal(res.status, 429);
  });

  test('spreading attempts across many IPs still trips the global limit', async () => {
    // Behind Cloudflare we see the real client IP, so a per-IP cap alone would let
    // an attacker with a pool of addresses guess in parallel indefinitely.
    let sawLockout = false;
    for (let i = 0; i < 120 && !sawLockout; i++) {
      const res = await tryPin('000003', `198.51.100.${i % 250}`);
      if (res.status === 429) sawLockout = true;
    }
    assert.ok(sawLockout, 'distributed guessing must be bounded, not just per-IP guessing');
  });
});
