/**
 * Staff auth: password hashing, bearer sessions, and the login throttle.
 *
 * Vitest isolates each file's module registry, and vite.config.ts points DB_PATH
 * at ':memory:', so this file gets a private database. State persists between
 * tests within the file, so each test uses its own email / IP.
 */
import { test, describe, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  login,
  logout,
  sessionStaff,
  seedStaff,
  loginBlocked,
  noteLoginAttempt,
  ensureLiveEvent,
} from '$lib/server/auth';
import { config } from '$lib/server/config';
import {
  createStaff,
  createStaffSession,
  genId,
  now,
  staffByEmail,
  staffSession,
  updateStaffPassword,
} from '$lib/server/db';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Register a staff account and return its credentials. */
async function makeStaff(email: string, password = `pw-${email}`) {
  createStaff({
    eventId: ensureLiveEvent(),
    id: genId(),
    displayName: email.split('@')[0] ?? 'Helper',
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
    status: 'active',
  });
  return { email, password };
}

describe('hashPassword / verifyPassword', () => {
  test('stores salt:hash and salts randomly', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    assert.match(a, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.notEqual(a, b, 'same password must not produce the same hash');
  });

  test('round-trips, including empty and unicode passwords', async () => {
    assert.equal(await verifyPassword('hunter2', await hashPassword('hunter2')), true);
    assert.equal(await verifyPassword('', await hashPassword('')), true);
    assert.equal(await verifyPassword('pässwörd🍹', await hashPassword('pässwörd🍹')), true);
  });

  test('rejects the wrong password', async () => {
    assert.equal(await verifyPassword('nope', await hashPassword('hunter2')), false);
  });

  test('rejects malformed stored hashes instead of accepting any password', async () => {
    // 'aa:zz' and 'aa:0' are the dangerous ones: a non-hex hash portion decodes to
    // a zero-length buffer, so deriving a zero-length key makes
    // timingSafeEqual(<empty>, <empty>) pass — any password would authenticate.
    for (const stored of ['', 'nocolon', ':', 'aa:', 'deadbeef', 'aa:zz', 'aa:0', ':zz']) {
      assert.equal(
        await verifyPassword('anything', stored),
        false,
        `stored=${JSON.stringify(stored)}`,
      );
    }
  });
});

describe('sessions', () => {
  test('a token round-trips to its staff member', async () => {
    const { email, password } = await makeStaff('session@local');
    const result = await login(email, password);
    assert.ok(result);
    const resolved = sessionStaff(result.token);
    assert.ok(resolved);
    assert.equal(resolved.email, email);
    assert.equal(resolved.role, 'admin');
    assert.equal(resolved.status, 'active');
    assert.ok(resolved.id, 'the session should resolve to a staff id');
    assert.ok(resolved.name, 'a display name is always present');
  });

  test('the raw token is never stored — only its sha256', async () => {
    const { email, password } = await makeStaff('hashed@local');
    const result = await login(email, password);
    assert.ok(result);
    assert.equal(staffSession(result.token), null, 'the raw token must not be a key');
    assert.ok(staffSession(sha256(result.token)), 'the hashed token should be the key');
  });

  test('an expired session does not resolve', async () => {
    const { email } = await makeStaff('expired@local');
    const row = staffByEmail(email);
    assert.ok(row);
    createStaffSession(sha256('expired-token'), row.id, now() - 1);
    assert.equal(sessionStaff('expired-token'), null);
  });

  test('missing or unknown tokens resolve to null', async () => {
    assert.equal(sessionStaff(undefined), null);
    assert.equal(sessionStaff(''), null);
    assert.equal(sessionStaff('garbage'), null);
  });

  test('logout invalidates the token; logging out nothing is safe', async () => {
    const { email, password } = await makeStaff('logout@local');
    const result = await login(email, password);
    assert.ok(result);
    logout(result.token);
    assert.equal(sessionStaff(result.token), null);
    assert.doesNotThrow(() => logout(undefined));
  });
});

describe('login', () => {
  test('normalises the email (trim + lowercase)', async () => {
    const { password } = await makeStaff('norm@local');
    assert.ok(await login('  NORM@LOCAL  ', password));
  });

  test('a wrong password issues no token', async () => {
    const { email } = await makeStaff('wrong@local');
    assert.equal(await login(email, 'not-it'), null);
  });

  test('an unknown email returns null without throwing (constant-time path)', async () => {
    assert.equal(await login('ghost@local', 'whatever'), null);
  });

  test('a successful login purges expired sessions', async () => {
    const { email, password } = await makeStaff('purge@local');
    const row = staffByEmail(email);
    assert.ok(row);
    const staleHash = sha256('stale-token');
    createStaffSession(staleHash, row.id, now() - 1000);
    assert.ok(staffSession(staleHash), 'precondition: the stale row exists');

    assert.ok(await login(email, password));
    assert.equal(staffSession(staleHash), null, 'the expired session should have been purged');
  });
});

describe('seedStaff', () => {
  test('creates the env-configured account, idempotently', async () => {
    await seedStaff();
    const first = staffByEmail(config.staff.email);
    assert.ok(first, 'expected the seeded account to exist');

    await seedStaff();
    const second = staffByEmail(config.staff.email);
    assert.ok(second);
    assert.equal(second.id, first.id, 'must not create a second account');
    assert.equal(
      second.passwordHash,
      first.passwordHash,
      'an unchanged password must not be re-hashed',
    );
    assert.equal(await verifyPassword(config.staff.password, second.passwordHash ?? ''), true);
  });

  test('rotates the stored password when the env value differs', async () => {
    await seedStaff();
    const before = staffByEmail(config.staff.email);
    assert.ok(before);
    // Simulate a hash that no longer matches the configured password.
    updateStaffPassword(before.id, await hashPassword('some-old-password'));
    assert.equal(
      await verifyPassword(config.staff.password, await hashPassword('some-old-password')),
      false,
    );

    await seedStaff();
    const after = staffByEmail(config.staff.email);
    assert.ok(after);
    assert.equal(await verifyPassword(config.staff.password, after.passwordHash ?? ''), true);
  });
});

describe('login throttle', () => {
  afterEach(() => vi.useRealTimers());

  test('blocks after the 10th failure and resets on success', async () => {
    const ip = 'ip-block';
    for (let i = 0; i < 9; i++) noteLoginAttempt(ip, false);
    assert.equal(loginBlocked(ip), false, '9 failures must not block');

    noteLoginAttempt(ip, false);
    assert.equal(loginBlocked(ip), true, 'the 10th failure should block');

    noteLoginAttempt(ip, true);
    assert.equal(loginBlocked(ip), false, 'a success should clear the counter');
  });

  test('is per-IP', async () => {
    const ip = 'ip-isolated';
    for (let i = 0; i < 10; i++) noteLoginAttempt(ip, false);
    assert.equal(loginBlocked(ip), true);
    assert.equal(loginBlocked('ip-other'), false, 'one IP must not block another');
  });

  test('the window expires and the count restarts', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const ip = 'ip-window';
    for (let i = 0; i < 10; i++) noteLoginAttempt(ip, false);
    assert.equal(loginBlocked(ip), true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    assert.equal(loginBlocked(ip), false, 'the window should have expired');

    noteLoginAttempt(ip, false);
    assert.equal(loginBlocked(ip), false, 'the count should restart at 1, not 11');
  });
});
