/**
 * Bar sessions — the credential for working one party.
 *
 * **There is one kind of principal here now.** This file used to hold two, admin and
 * bartender, with the admin signing in by email and password against a seeded row in
 * the environment. That admin is a real account today (`accounts.ts`), so what
 * remains is the door for people who deliberately have no account: a helper let in
 * by a code the host reads out.
 *
 * A helper's `deviceId` is their *identity*, never their credential — it travels in
 * every order payload, so it isn't secret. The credential is always a server-issued
 * bearer session, of which only the SHA-256 is stored.
 *
 * A staff row may carry a `userId`. When it does, the session speaks for that
 * account too: `resolveActor` reads the role through the link, which is how the
 * keypad returns someone to the bar as *themselves* rather than as a generic shift.
 */
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Staff, StaffStatus } from '$lib/shared';
import { JOIN_CODE_LENGTH, JOIN_CODE_TTL_MS, isValidJoinCode } from '$lib/shared';
import {
  clearPin,
  clearStaffClaim,
  createJoinCode as dbCreateJoinCode,
  createStaff,
  createStaffSession,
  deleteStaffSession,
  genId,
  liveJoinCode,
  now,
  pendingStaffForDevice,
  pinFor,
  purgeExpiredSessions,
  purgeStalePendingStaff,
  renameStaff,
  setJoinedVia,
  setPin,
  setStaffClaim,
  setStaffStatus,
  staffByClaim,
  staffByIdUnscoped,
  staffForAccount,
  staffForDevice,
  staffSession,
  type StaffRow,
} from './db';
import { createRateLimiter } from './ratelimit';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** How long an unapproved request stays collectable before it's swept. */
const CLAIM_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — comfortably one party
const DUMMY_SALT = randomBytes(16); // constant-time "no such user" path
const KEY_LEN = 64; // derived-key length, shared by hash + verify

/**
 * scrypt cost. N is 4× Node's default (2^14); r/p are the standard defaults.
 * `maxmem` must exceed 128·N·r (=64 MiB here) or scrypt refuses to run.
 *
 * Deliberately not pushed to OWASP's 2^17 floor: that needs ~128 MiB per call,
 * and since an unauthenticated caller can trigger hashing via /api/auth/login,
 * a higher setting turns this into a memory-amplification vector on a shared
 * NAS. The real protection is that STAFF_PASSWORD is a long random secret
 * (config.ts refuses to fall back to a guessable one in production), which no
 * KDF cost meaningfully changes. Async so hashing never blocks the event loop.
 */
const SCRYPT: { N: number; r: number; p: number; maxmem: number } = {
  N: 65_536,
  r: 8,
  p: 1,
  maxmem: 96 * 1024 * 1024,
};

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: typeof SCRYPT,
) => Promise<Buffer>;

/** `salt:hash` (hex). scrypt is intentionally slow — a built-in brute-force brake. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN, SCRYPT);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  // A malformed hash portion (non-hex, odd length, truncated) decodes short or
  // empty. Deriving a key of that length would then make timingSafeEqual pass on
  // two empty buffers — i.e. any password would authenticate. Require the exact
  // length we produce, so only a well-formed hash can ever be compared.
  if (expected.length !== KEY_LEN) return false;
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEY_LEN, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Strip anything internal before a staff row ever leaves the server. */
export function toStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.displayName,
    status: row.status as StaffStatus,
    createdAt: row.createdAt,
  };
}

/** Issue a session for a staff row. */
function startSession(row: StaffRow): { token: string; staff: Staff } {
  purgeExpiredSessions();
  const token = randomBytes(32).toString('hex');
  createStaffSession(sha256(token), row.id, now() + SESSION_TTL_MS);
  return { token, staff: toStaff(row) };
}

/** Set or change the keypad code for an account. Hashed like a password. */
export async function setAccountPin(userId: string, pin: string): Promise<void> {
  setPin(userId, await hashPassword(pin));
}

export const clearAccountPin = (userId: string): void => clearPin(userId);

export const hasAccountPin = (userId: string): boolean => pinFor(userId) !== null;

/**
 * Get back behind a bar with the keypad, as yourself.
 *
 * The device already knows *who* — it signed in properly once — so this proves it is
 * still that person, not which person it is. The PIN is stored hashed against the
 * account rather than sitting in the environment: the old shared `STAFF_PIN` had no
 * owner, so it could not be rotated by the person it belonged to and could not tell
 * two people apart.
 *
 * The session it returns is a **staff** one, because Better Auth has no supported
 * way to mint an account session without a credential (PLATFORM-PLAN §8 phase 0.7).
 * That costs nothing here: the staff row carries `userId`, so `resolveActor` reads
 * the account role through it and the holder is themselves again.
 *
 * A short numeric secret is only ~10^4–10^6 possibilities, so **throttling is the
 * whole defence** — see the limiter at the endpoint, which is per-IP and per-account.
 */
export async function signInWithPin(
  eventId: string,
  userId: string,
  pin: string,
): Promise<{ token: string; staff: Staff } | null> {
  const stored = pinFor(userId);
  // Hash regardless, so "no PIN set" and "wrong PIN" cost the same. Otherwise the
  // response time says which accounts have a keypad configured.
  if (!stored) {
    await scryptAsync(pin, DUMMY_SALT, KEY_LEN, SCRYPT);
    return null;
  }
  if (!(await verifyPassword(pin, stored))) return null;

  const row = staffForAccount(eventId, userId);
  if (!row || row.status !== 'active') return null;
  return startSession(row);
}

// ---- join codes ------------------------------------------------------------

/**
 * Mint a code the host reads out to someone standing next to them.
 *
 * This is the primary way helpers get in. Request-and-approve solves *remote*
 * onboarding, which a house party doesn't have — the host is right there, so a
 * code collapses ask→wait→approve→collect into one step that can't stall.
 *
 * Short-lived and revocable, and it only ever grants bar access at one party, so
 * the worst a leaked code buys is fifteen minutes of it, revocable at any time.
 */
export function createJoinCode(createdBy: string | null): { code: string; expiresAt: number } {
  // 6 digits from rejection-free arithmetic on a uniform 32-bit draw would still
  // bias slightly; randomInt is uniform by construction.
  const code = String(randomInt(0, 10 ** JOIN_CODE_LENGTH)).padStart(JOIN_CODE_LENGTH, '0');
  const expiresAt = now() + JOIN_CODE_TTL_MS;
  dbCreateJoinCode(sha256(code), expiresAt, createdBy);
  return { code, expiresAt };
}

/**
 * Redeem a code: create (or revive) an active helper bound to this device and
 * issue them a session. Returns null for an unknown, expired or malformed code.
 *
 * A device that already has a pending request is upgraded rather than duplicated —
 * someone who asked, got impatient, and then went and got the code shouldn't end
 * up as two rows in the host's list.
 */
export function redeemJoinCode(
  eventId: string,
  code: string,
  name: string,
  deviceId: string,
): { token: string; staff: Staff } | null {
  if (!isValidJoinCode(code) || !deviceId) return null;
  if (!liveJoinCode(sha256(code))) return null;

  const existing = staffForDevice(eventId, deviceId);
  if (existing) {
    // Revive the row this device already has rather than adding a second. A code
    // grants access without anyone approving it, so `approved_by` stays null and
    // `joined_via` carries the fact instead.
    setStaffStatus(existing.id, 'active', null);
    setJoinedVia(existing.id, 'code');
    clearStaffClaim(existing.id);
    if (name) renameStaff(existing.id, name);
    const row = staffByIdUnscoped(existing.id);
    return row ? startSession(row) : null;
  }

  const id = genId();
  createStaff({ id, eventId, displayName: name, deviceId, status: 'active', joinedVia: 'code' });
  const row = staffByIdUnscoped(id);
  return row ? startSession(row) : null;
}

/**
 * Open the bar for a host, using the account they signed up with.
 *
 * Without this the loop doesn't close: a host could create their party and then
 * have no way into its bar screen except a PIN meant for Dan. The staff session is
 * still what the bar endpoints consume — this only mints one from an account,
 * rather than introducing a second thing for those endpoints to understand.
 */
export function barSessionForAccount(
  eventId: string,
  userId: string,
  displayName = '',
): { token: string; staff: Staff } | null {
  const row = staffForAccount(eventId, userId);
  if (row) {
    // A revoked row is not a dead end for an account-holder. Their access comes
    // from the account — the guard has already said they may work this bar — so the
    // row is bookkeeping, and refusing here would make "revoke all helpers"
    // permanently lock the person who tapped it out of their own party.
    if (row.status !== 'active') setStaffStatus(row.id, 'active', null);
    const current = staffByIdUnscoped(row.id);
    return current ? startSession(current) : null;
  }

  // No row yet — create one. The caller has already been through the guard, so the
  // fact they're asking means they may work this bar; refusing here would mean Dan
  // could act on any party through his cookie but not hold a token for one, which is
  // an arbitrary distinction dressed up as a permission.
  const id = genId();
  createStaff({ id, eventId, userId, displayName, status: 'active', joinedVia: 'seed' });
  const created = staffByIdUnscoped(id);
  return created ? startSession(created) : null;
}

// ---- request to help -------------------------------------------------------

/**
 * Register a request to help at the bar. Returns the one-time claim secret the
 * device keeps in order to collect its session once an admin approves. Asking
 * again from the same device returns a fresh secret for the same request rather
 * than queueing duplicates.
 */
export function requestStaffAccess(input: {
  eventId: string;
  name: string;
  deviceId: string;
  email?: string | null;
}): string {
  purgeStalePendingStaff();
  const claim = randomBytes(32).toString('hex');
  const existing = pendingStaffForDevice(input.eventId, input.deviceId);
  if (existing) {
    // Re-issue against the same row so a lost secret is recoverable and the
    // admin's list doesn't fill with duplicates of one person.
    setStaffClaim(existing.id, sha256(claim), now() + CLAIM_TTL_MS);
    return claim;
  }
  createStaff({
    id: genId(),
    eventId: input.eventId,
    displayName: input.name,
    deviceId: input.deviceId,
    status: 'pending',
    claimHash: sha256(claim),
    claimExpiresAt: now() + CLAIM_TTL_MS,
  });
  return claim;
}

/**
 * Exchange a claim secret for the current decision. On approval this consumes the
 * claim and returns a session, so an approval can only ever be collected once.
 */
export function claimStaffAccess(
  claim: string,
):
  { status: 'pending' } | { status: 'denied' } | { status: 'active'; token: string; staff: Staff } {
  const row = claim ? staffByClaim(sha256(claim)) : null;
  // An unknown or expired claim is indistinguishable from a denial, so a caller
  // can't probe for which secrets exist.
  if (!row) return { status: 'denied' };
  if (row.status === 'pending') {
    if ((row.claimExpiresAt ?? 0) < now()) return { status: 'denied' };
    return { status: 'pending' };
  }
  if (row.status !== 'active') return { status: 'denied' };
  clearStaffClaim(row.id);
  return { status: 'active', ...startSession(row) };
}

/** Approve a pending request. Only meaningful for a row that is still pending. */
export function approveStaff(id: string, approvedBy: string | null): boolean {
  const row = staffByIdUnscoped(id);
  if (!row || row.status !== 'pending') return false;
  setStaffStatus(id, 'active', approvedBy);
  return true;
}

// ---- brute-force brakes ----------------------------------------------------

/**
 * Keypad throttle, in two layers: **per IP and per account.**
 *
 * Per-IP alone isn't enough — a 6-digit PIN is a 10^6 space, and behind Cloudflare
 * we see the real client IP, so an attacker with a few thousand addresses could
 * spread the guessing thinly and stay under any per-IP cap.
 *
 * The second layer used to be **global**, which was right when there was one shared
 * PIN and is wrong now that everyone has their own: a global counter means one
 * attacker grinding at one account locks every other person's keypad too. Keying it
 * to the account being guessed at bounds the damage to that account, which is the
 * only one actually under attack.
 *
 * Jamming one account's keypad is still possible, and still acceptable: signing in
 * with the account itself always works, so nobody is ever locked out of the app —
 * only out of the shortcut. A correct PIN clears both counters.
 */
const PIN_WINDOW_MS = 15 * 60 * 1000;
const pinByIp = createRateLimiter({ max: 10, windowMs: PIN_WINDOW_MS });
const pinByAccount = createRateLimiter({ max: 10, windowMs: PIN_WINDOW_MS });

export function pinBlocked(ip: string, userId: string): boolean {
  return pinByIp.isLimited(ip) || (userId !== '' && pinByAccount.isLimited(userId));
}

export function notePinAttempt(ip: string, userId: string, ok: boolean): void {
  if (ok) {
    pinByIp.clear(ip);
    if (userId) pinByAccount.clear(userId);
    return;
  }
  pinByIp.record(ip);
  if (userId) pinByAccount.record(userId);
}

/**
 * Join-code throttle. Identical reasoning to the PIN: a 6-digit code is a 10^6
 * space, so per-IP alone would let a pool of addresses grind it down. The global
 * limiter is what actually bounds it. Codes also expire, which shrinks the window
 * an attacker has to work in.
 */
const GLOBAL_KEY = 'all';
const joinLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const joinGlobalLimiter = createRateLimiter({ max: 60, windowMs: 15 * 60 * 1000 });

export function joinBlocked(ip: string): boolean {
  return joinLimiter.isLimited(ip) || joinGlobalLimiter.isLimited(GLOBAL_KEY);
}

export function noteJoinAttempt(ip: string, ok: boolean): void {
  if (ok) {
    joinLimiter.clear(ip);
    joinGlobalLimiter.clear(GLOBAL_KEY);
    return;
  }
  joinLimiter.record(ip);
  joinGlobalLimiter.record(GLOBAL_KEY);
}

/**
 * Claim-polling throttle. The claim secret is long and random, so this is about
 * bounding the cost of a device polling for a decision, not guessing.
 */
const claimLimiter = createRateLimiter({ max: 120, windowMs: 60 * 1000 });

export function claimBlocked(ip: string): boolean {
  return claimLimiter.isLimited(ip);
}
export function noteClaimAttempt(ip: string): void {
  claimLimiter.record(ip);
}

/**
 * Resolve a bearer token to a staff member.
 *
 * Checks status as well as expiry, so revoking someone takes effect immediately
 * even if their token hasn't expired.
 */
/**
 * The **row**, not the DTO, because the guard needs `userId` — the link that lets a
 * bar session speak for the account behind it. Callers that answer a client use
 * `toStaff` on the way out.
 */
export function sessionStaff(token: string | undefined): StaffRow | null {
  if (!token) return null;
  const sess = staffSession(sha256(token));
  if (!sess || sess.expiresAt < now()) return null;
  const row = staffByIdUnscoped(sess.staffId);
  if (!row || row.status !== 'active') return null;
  return row;
}

export function logout(token: string | undefined): void {
  if (token) deleteStaffSession(sha256(token));
}
