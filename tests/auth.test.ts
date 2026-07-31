/**
 * Bar sessions: hashing, bearer tokens, and the keypad.
 *
 * **What left this file matters as much as what stayed.** There used to be suites
 * for `login` (email and password against a staff row seeded from the environment),
 * `seedStaff`, and a login throttle. All three are deleted rather than ported,
 * because the thing they tested is gone: signing in is an account's job now, and
 * what remains here is the credential for working one party's bar.
 *
 * Vitest isolates each file's module registry and `vite.config.ts` points DB_PATH at
 * ':memory:', so this file gets a private database. State persists across tests
 * within the file, so each one uses its own ids.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  logout,
  sessionStaff,
  setAccountPin,
  signInWithPin,
  pinBlocked,
  notePinAttempt,
} from '$lib/server/auth';
import {
  createStaff,
  createStaffSession,
  genId,
  now,
  pinFor,
  setStaffStatus,
  staffSession,
} from '$lib/server/db';
import { partyFor, person, useMemoryEmail, type Account } from './fixtures/people';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

let dan: Account;
let eventId = '';

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('auth-dan', 'admin');
  eventId = partyFor(dan.id, "Auth's party");
});

/** A shift at the party — optionally linked to an account — and a live session. */
function shift(name: string, userId: string | null = null): { id: string; token: string } {
  const id = genId();
  createStaff({ id, eventId, userId, displayName: name, status: 'active', joinedVia: 'code' });
  const token = `tok-${id}`;
  createStaffSession(sha256(token), id, now() + 60_000);
  return { id, token };
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
  test('a token round-trips to the shift it was issued for', () => {
    const { id, token } = shift('Session Helper');
    const resolved = sessionStaff(token);
    assert.ok(resolved);
    assert.equal(resolved.id, id);
    assert.equal(resolved.eventId, eventId, 'a bar session names exactly one party');
    assert.equal(resolved.status, 'active');
  });

  test('it resolves the row, not the client-facing shape', () => {
    // The guard needs `userId` — the link that lets a bar session speak for the
    // account behind it, and the whole reason the keypad can return someone to the
    // bar as themselves. The client-facing `Staff` deliberately doesn't carry it.
    const { token } = shift('Linked', dan.id);
    assert.equal(sessionStaff(token)?.userId, dan.id);
  });

  test('the raw token is never stored — only its sha256', () => {
    const { token } = shift('Hashed');
    assert.equal(staffSession(token), null, 'the raw token must not be a key');
    assert.ok(staffSession(sha256(token)), 'the hashed token should be the key');
  });

  test('an expired session does not resolve', () => {
    const id = genId();
    createStaff({ id, eventId, displayName: 'Expired', status: 'active' });
    createStaffSession(sha256('expired-token'), id, now() - 1);
    assert.equal(sessionStaff('expired-token'), null);
  });

  test('missing or unknown tokens resolve to null', () => {
    assert.equal(sessionStaff(undefined), null);
    assert.equal(sessionStaff(''), null);
    assert.equal(sessionStaff('garbage'), null);
  });

  test('logout invalidates the token; logging out nothing is safe', () => {
    const { token } = shift('Logout');
    logout(token);
    assert.equal(sessionStaff(token), null);
    assert.doesNotThrow(() => logout(undefined));
  });

  test('a revoked shift stops resolving, even with a token that has not expired', () => {
    // The token outlives the revocation by design; it's the lookup that has to stop
    // them, not the absence of a credential.
    const { id, token } = shift('Revoked');
    assert.ok(sessionStaff(token));
    setStaffStatus(id, 'revoked');
    assert.equal(sessionStaff(token), null);
  });
});

describe('the keypad', () => {
  test('the right PIN returns a session that speaks for the account', async () => {
    await setAccountPin(dan.id, '123456');
    const result = await signInWithPin(eventId, dan.id, '123456');
    assert.ok(result, 'the correct PIN should sign in');
    assert.equal(sessionStaff(result.token)?.userId, dan.id);
  });

  test('a wrong PIN does not', async () => {
    await setAccountPin(dan.id, '123456');
    assert.equal(await signInWithPin(eventId, dan.id, '654321'), null);
  });

  test('an account with no PIN set cannot be signed in with one', async () => {
    const other = await person('auth-nopin');
    assert.equal(await signInWithPin(eventId, other.id, '123456'), null);
  });

  test('an account that is not working this party gets nothing', async () => {
    // The PIN proves who you are; it does not grant a shift you never had.
    const other = await person('auth-elsewhere');
    await setAccountPin(other.id, '111111');
    assert.equal(await signInWithPin(eventId, other.id, '111111'), null);
  });

  test('the PIN is stored hashed, never in the clear', async () => {
    await setAccountPin(dan.id, '246813');
    const stored = pinFor(dan.id);
    assert.ok(stored);
    assert.ok(!stored.includes('246813'), 'the PIN itself must not be recoverable');
    assert.match(stored, /^[0-9a-f]+:[0-9a-f]+$/, 'salt:hash, like a password');
  });
});

describe('the keypad throttle', () => {
  test('blocks after the 10th failure and clears on success', () => {
    const ip = '10.0.0.1';
    const who = 'acct-throttle';
    for (let i = 0; i < 9; i++) notePinAttempt(ip, who, false);
    assert.equal(pinBlocked(ip, who), false, 'nine failures is still allowed');
    notePinAttempt(ip, who, false);
    assert.equal(pinBlocked(ip, who), true);
    notePinAttempt(ip, who, true);
    assert.equal(pinBlocked(ip, who), false, 'a correct PIN clears both counters');
  });

  test('is per-account, so one victim cannot lock everyone else out', () => {
    // This is why the second layer stopped being global. With one shared PIN a
    // global counter was right; with one PIN each it means an attacker grinding at
    // a single person shuts every other keypad in the building.
    const ip = '10.0.0.2';
    for (let i = 0; i < 10; i++) notePinAttempt(ip, 'acct-victim', false);
    assert.equal(pinBlocked('10.0.0.3', 'acct-victim'), true, 'the account under attack is shut');
    assert.equal(pinBlocked('10.0.0.3', 'acct-bystander'), false, 'everyone else carries on');
  });

  test('is also per-IP, so one address cannot spread its guessing thinly', () => {
    const ip = '10.0.0.4';
    for (let i = 0; i < 10; i++) notePinAttempt(ip, `acct-spread-${i}`, false);
    assert.equal(pinBlocked(ip, 'acct-spread-fresh'), true);
  });
});
