/**
 * Join codes — the fast path onto the bar.
 *
 * A 6-digit code is a small keyspace held by an unauthenticated endpoint, so the
 * things worth asserting are the boundaries: it expires, it's revocable, it only
 * ever grants `bartender`, it can't be brute-forced, and only an admin can mint one.
 */
import { test, describe, beforeAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { JOIN_CODE_LENGTH, JOIN_CODE_TTL_MS, type Staff } from '$lib/shared';
import { request } from './app';
import { hashPassword } from '$lib/server/auth';
import { createStaff, genId, clearJoinCodes, listStaff, staffForDevice } from '$lib/server/db';

const ADMIN = { email: 'joinadmin@local', password: 'join-admin-pw' };
const HELPER = { email: 'joinhelper@local', password: 'join-helper-pw' };
let adminToken = '';
let helperToken = '';

let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}`;

const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });

/** Mint a code as the host. */
async function mintCode(): Promise<{ code: string; expiresAt: number }> {
  const res = await request('/api/staff/join-code', send('POST', {}, asAdmin()));
  assert.equal(res.status, 200);
  return (await res.json()) as { code: string; expiresAt: number };
}

/** Redeem a code as a helper on `deviceId`. */
const redeem = (code: string, name: string, deviceId: string, ip = freshIp()) =>
  request('/api/staff/join', send('POST', { code, name, deviceId }, { 'cf-connecting-ip': ip }));

beforeAll(async () => {
  for (const [who, role] of [
    [ADMIN, 'admin'],
    [HELPER, 'bartender'],
  ] as const) {
    createStaff({
      id: genId(),
      displayName: role,
      email: who.email,
      passwordHash: await hashPassword(who.password),
      role,
      status: 'active',
    });
  }
  adminToken = (
    (await (await request('/api/auth/login', send('POST', ADMIN))).json()) as {
      token: string;
    }
  ).token;
  helperToken = (
    (await (await request('/api/auth/login', send('POST', HELPER))).json()) as {
      token: string;
    }
  ).token;
  assert.ok(adminToken && helperToken);
});

beforeEach(() => clearJoinCodes());

describe('minting a code', () => {
  test('returns a code of the expected shape with a sane expiry', async () => {
    const { code, expiresAt } = await mintCode();
    assert.match(code, new RegExp(`^\\d{${JOIN_CODE_LENGTH}}$`));
    const ttl = expiresAt - Date.now();
    assert.ok(ttl > 0 && ttl <= JOIN_CODE_TTL_MS + 1000, `ttl was ${ttl}`);
  });

  test('two codes differ — it is not a fixed value', async () => {
    const a = await mintCode();
    const b = await mintCode();
    assert.notEqual(a.code, b.code);
  });

  test('is admin-only: a helper cannot mint themselves colleagues', async () => {
    const res = await request(
      '/api/staff/join-code',
      send('POST', {}, { Authorization: `Bearer ${helperToken}` }),
    );
    assert.equal(res.status, 403);
  });

  test('is closed to strangers', async () => {
    assert.equal((await request('/api/staff/join-code', send('POST', {}))).status, 401);
  });
});

describe('redeeming a code', () => {
  test('puts someone on the bar immediately, as a bartender', async () => {
    const { code } = await mintCode();
    const res = await redeem(code, 'Ravi', 'device-ravi');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string; staff: Staff };
    assert.ok(body.token);
    assert.equal(body.staff.name, 'Ravi');
    assert.equal(body.staff.status, 'active', 'no waiting — that is the whole point');
    assert.equal(body.staff.role, 'bartender');
  });

  test('the session it issues really works, but is not an admin one', async () => {
    const { code } = await mintCode();
    const { token } = (await (await redeem(code, 'Ravi', 'device-ravi2')).json()) as {
      token: string;
    };
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await request('/api/orders', { headers: auth })).status, 200);
    // A code must never be an escalation path to approving other people.
    assert.equal((await request('/api/staff', { headers: auth })).status, 403);
  });

  test('one code can onboard several helpers', async () => {
    // A host reads it out once to whoever is around; making it single-use would
    // mean re-minting for every person.
    const { code } = await mintCode();
    for (const name of ['Ann', 'Ben', 'Cal']) {
      assert.equal((await redeem(code, name, `device-${name}`)).status, 200);
    }
  });

  test('a device that already asked is upgraded, not duplicated', async () => {
    // Someone asks, gets impatient, then goes and gets the code. The host should
    // see one person, not a pending request plus a helper.
    await request('/api/staff/requests', send('POST', { name: 'Mo', deviceId: 'device-mo' }));
    const before = listStaff().filter((s) => s.deviceId === 'device-mo');
    assert.equal(before.length, 1);
    assert.equal(before[0]?.status, 'pending');

    const { code } = await mintCode();
    assert.equal((await redeem(code, 'Mo', 'device-mo')).status, 200);

    const after = listStaff().filter((s) => s.deviceId === 'device-mo');
    assert.equal(after.length, 1, 'no duplicate row');
    assert.equal(after[0]?.status, 'active');
    // The claim is spent, so the old pending request can't also be collected.
    assert.equal(staffForDevice('device-mo')?.claimHash ?? null, null);
  });

  test('rejects a wrong code, and a malformed one, the same way', async () => {
    await mintCode();
    for (const bad of ['000000', '12345', 'abcdef', '', '1234567']) {
      const res = await redeem(bad, 'Nope', 'device-nope');
      assert.equal(res.status, 401, bad);
    }
  });

  test('requires a name and a device, so the host knows who joined', async () => {
    const { code } = await mintCode();
    assert.equal((await redeem(code, '', 'device-x')).status, 422);
    assert.equal((await redeem(code, 'Someone', '')).status, 422);
  });

  test('a revoked code stops working immediately', async () => {
    const { code } = await mintCode();
    assert.equal((await redeem(code, 'Early', 'device-early')).status, 200);
    const res = await request('/api/staff/join-code', {
      method: 'DELETE',
      headers: asAdmin(),
    });
    assert.equal(res.status, 200);
    assert.equal(
      (await redeem(code, 'Late', 'device-late')).status,
      401,
      '"stop sharing" has to actually stop it',
    );
  });

  test('revoking codes does not evict helpers who already joined', async () => {
    const { code } = await mintCode();
    const { token } = (await (await redeem(code, 'Stay', 'device-stay')).json()) as {
      token: string;
    };
    await request('/api/staff/join-code', { method: 'DELETE', headers: asAdmin() });
    const res = await request('/api/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200, 'closing the door must not throw out the people inside');
  });
});

describe('throttling', () => {
  test('guessing from one IP is locked out', async () => {
    const ip = freshIp();
    let sawLockout = false;
    for (let i = 0; i < 15 && !sawLockout; i++) {
      if ((await redeem('000001', 'Guess', 'device-guess', ip)).status === 429) sawLockout = true;
    }
    assert.ok(sawLockout, 'a 10^6 keyspace needs a per-IP brake');
  });

  test('spreading guesses across IPs still trips the global limit', async () => {
    let sawLockout = false;
    for (let i = 0; i < 120 && !sawLockout; i++) {
      const res = await redeem('000002', 'Guess', 'device-guess', `198.51.100.${i % 250}`);
      if (res.status === 429) sawLockout = true;
    }
    assert.ok(sawLockout, 'distributed guessing must be bounded too');
  });
});
