/**
 * Staff auth. Two kinds of principal, deliberately asymmetric:
 *
 *   • admin     — email + password (scrypt), so they can sign in from ANY device.
 *                 Seeded from env, and never demotable, so you can't lock yourself
 *                 out of your own bar.
 *   • bartender — a helper whose access an admin approved for one device. No
 *                 password to invent or remember.
 *
 * A helper's deviceId is their *identity*, never their credential: it travels in
 * every order payload, so it isn't secret. The credential is always a
 * server-issued bearer session, of which only the SHA-256 is stored.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Staff, StaffStatus } from '@cocktails/shared';
import { config } from './config.ts';
import {
  clearStaffClaim,
  createStaff,
  createStaffSession,
  deleteStaffSession,
  ensureAdmin,
  genId,
  now,
  pendingStaffForDevice,
  purgeExpiredSessions,
  purgeStalePendingStaff,
  setStaffClaim,
  setStaffStatus,
  staffByClaim,
  staffByEmail,
  staffById,
  staffSession,
  updateStaffPassword,
  type StaffRow,
} from './db.ts';
import { createRateLimiter } from './ratelimit.ts';

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

/** Strip secrets before a staff row ever leaves the server. */
export function toStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'bartender',
    status: row.status as StaffStatus,
    createdAt: row.created_at,
  };
}

/**
 * Ensure the env-configured admin exists with the current password.
 * Env is the source of truth, so changing STAFF_PASSWORD and redeploying just
 * applies — which also means a change to the scrypt parameters above re-derives
 * the stored hash on the next boot.
 */
export async function seedStaff(): Promise<void> {
  if (!config.staff.email || !config.staff.password) return;
  const existing = staffByEmail(config.staff.email);
  if (!existing) {
    createStaff({
      id: genId(),
      displayName: config.staff.email.split('@')[0] || 'Admin',
      email: config.staff.email,
      passwordHash: await hashPassword(config.staff.password),
      role: 'admin',
      status: 'active',
    });
    console.log(`\u{1F464} created admin account: ${config.staff.email}`);
    return;
  }
  // Always re-assert admin+active: the account that owns the bar must never end up
  // demoted or revoked, or nobody could approve anyone again.
  if (existing.role !== 'admin' || existing.status !== 'active') ensureAdmin(existing.id);
  if (!(await verifyPassword(config.staff.password, existing.password_hash ?? ''))) {
    updateStaffPassword(existing.id, await hashPassword(config.staff.password));
    console.log(`\u{1F511} updated admin password: ${config.staff.email}`);
  }
}

/** Issue a session for a staff row. */
function startSession(row: StaffRow): { token: string; staff: Staff } {
  purgeExpiredSessions();
  const token = randomBytes(32).toString('hex');
  createStaffSession(sha256(token), row.id, now() + SESSION_TTL_MS);
  return { token, staff: toStaff(row) };
}

/** Verify credentials → issue a session token. Returns null on bad creds. */
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; staff: Staff } | null> {
  const row = staffByEmail(email.trim().toLowerCase());
  // Hash regardless so a missing account, a helper with no password, and a wrong
  // password all cost the same — otherwise response timing reveals which emails exist.
  if (!row?.password_hash || row.status !== 'active') {
    await scryptAsync(password, DUMMY_SALT, KEY_LEN, SCRYPT);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return startSession(row);
}

/**
 * Sign in as the admin with the short PIN.
 *
 * The PIN is compared against env directly rather than stored: env is already the
 * source of truth for the admin's credentials, so hashing a copy into the database
 * would just add a second place for it to go stale.
 *
 * A 6-digit PIN is only 10^6 possibilities, so throttling is the whole defence —
 * see `pinBlocked`, which is both per-IP *and* global.
 */
export function loginWithPin(pin: string): { token: string; staff: Staff } | null {
  const expected = config.staff.pin;
  if (!expected || !config.staff.email) return null;
  const supplied = Buffer.from(pin);
  const target = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch. It
  // leaks only how many digits the PIN has, which the keypad already advertises.
  if (supplied.length !== target.length || !timingSafeEqual(supplied, target)) return null;
  const row = staffByEmail(config.staff.email);
  if (!row || row.status !== 'active') return null;
  return startSession(row);
}

// ---- request to help -------------------------------------------------------

/**
 * Register a request to help at the bar. Returns the one-time claim secret the
 * device keeps in order to collect its session once an admin approves. Asking
 * again from the same device returns a fresh secret for the same request rather
 * than queueing duplicates.
 */
export function requestStaffAccess(input: {
  name: string;
  deviceId: string;
  email?: string | null;
}): string {
  purgeStalePendingStaff();
  const claim = randomBytes(32).toString('hex');
  const existing = pendingStaffForDevice(input.deviceId);
  if (existing) {
    // Re-issue against the same row so a lost secret is recoverable and the
    // admin's list doesn't fill with duplicates of one person.
    setStaffClaim(existing.id, sha256(claim), now() + CLAIM_TTL_MS);
    return claim;
  }
  createStaff({
    id: genId(),
    displayName: input.name,
    // Left null: an unverified email is a label, not proof, so it must not
    // collide with (or impersonate) a real sign-in account.
    email: null,
    deviceId: input.deviceId,
    role: 'bartender',
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
    if ((row.claim_expires_at ?? 0) < now()) return { status: 'denied' };
    return { status: 'pending' };
  }
  if (row.status !== 'active') return { status: 'denied' };
  clearStaffClaim(row.id);
  return { status: 'active', ...startSession(row) };
}

/** Approve a pending request. Only meaningful for a row that is still pending. */
export function approveStaff(id: string, approvedBy: string): boolean {
  const row = staffById(id);
  if (!row || row.status !== 'pending') return false;
  setStaffStatus(id, 'active', approvedBy);
  return true;
}

// ---- brute-force brakes ----------------------------------------------------

/** Login throttle, per client IP. */
const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

export function loginBlocked(ip: string): boolean {
  return loginLimiter.isLimited(ip);
}

export function noteLoginAttempt(ip: string, ok: boolean): void {
  if (ok) loginLimiter.clear(ip);
  else loginLimiter.record(ip);
}

/**
 * PIN throttle, in two layers.
 *
 * Per-IP alone isn't enough here: a 6-digit PIN is a 10^6 space, and behind
 * Cloudflare we see the real client IP, so an attacker with a few thousand
 * addresses could spread the guessing thinly and stay under any per-IP cap. The
 * global limiter closes that off — the whole PIN door shuts after GLOBAL_MAX bad
 * attempts in the window, whoever made them.
 *
 * The trade-off is that an attacker can deliberately jam the PIN door. That's
 * acceptable precisely because email + password remains available, so the bar can
 * always still be opened. A correct PIN clears the counters.
 */
const PIN_WINDOW_MS = 15 * 60 * 1000;
const pinLimiter = createRateLimiter({ max: 10, windowMs: PIN_WINDOW_MS });
const pinGlobalLimiter = createRateLimiter({ max: 60, windowMs: PIN_WINDOW_MS });
const GLOBAL_KEY = 'all';

export function pinBlocked(ip: string): boolean {
  return pinLimiter.isLimited(ip) || pinGlobalLimiter.isLimited(GLOBAL_KEY);
}

export function notePinAttempt(ip: string, ok: boolean): void {
  if (ok) {
    pinLimiter.clear(ip);
    pinGlobalLimiter.clear(GLOBAL_KEY);
    return;
  }
  pinLimiter.record(ip);
  pinGlobalLimiter.record(GLOBAL_KEY);
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
export function sessionStaff(token: string | undefined): Staff | null {
  if (!token) return null;
  const sess = staffSession(sha256(token));
  if (!sess || sess.expires_at < now()) return null;
  const row = staffById(sess.staff_id);
  if (!row || row.status !== 'active') return null;
  return toStaff(row);
}

export function logout(token: string | undefined): void {
  if (token) deleteStaffSession(sha256(token));
}
