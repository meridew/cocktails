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
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Staff, StaffStatus } from '$lib/shared';
import {
  clearStaffClaim,
  createStaff,
  createStaffSession,
  deleteStaffSession,
  genId,
  now,
  pendingStaffForDevice,
  purgeExpiredSessions,
  purgeStalePendingStaff,
  renameStaff,
  setJoinedVia,
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
    // Heal a nameless row rather than only naming new ones. The caller used to omit
    // the name entirely, so rows already exist showing a blank line on the Bar staff
    // screen; without this they would stay blank for the life of the party.
    if (!row.displayName && displayName) renameStaff(row.id, displayName);
    const current = staffForAccount(eventId, userId);
    return current ? startSession(current) : null;
  }

  // No row yet — create one. The caller has already been through the guard, so the
  // fact they're asking means they may work this bar; refusing here would mean Dan
  // could act on any party through his cookie but not hold a token for one, which is
  // an arbitrary distinction dressed up as a permission.
  const id = genId();
  createStaff({ id, eventId, userId, displayName, status: 'active', joinedVia: 'seed' });
  const created = staffForAccount(eventId, userId);
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

/** Approve a request already looked up inside the caller's party scope. */
export function approveStaff(row: StaffRow, approvedBy: string | null): boolean {
  if (row.status !== 'pending') return false;
  setStaffStatus(row.id, 'active', approvedBy);
  return true;
}

// ---- brute-force brakes ----------------------------------------------------

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
  return sessionStaffContext(token)?.staff ?? null;
}

/** Staff row plus the server-authored session boundary used by scoped push audiences. */
export function sessionStaffContext(
  token: string | undefined,
): { staff: StaffRow; expiresAt: number; tokenHash: string } | null {
  if (!token) return null;
  const tokenHash = sha256(token);
  const sess = staffSession(tokenHash);
  if (!sess || sess.expiresAt < now()) return null;
  const row = staffByIdUnscoped(sess.staffId);
  if (!row || row.status !== 'active') return null;
  return { staff: row, expiresAt: sess.expiresAt, tokenHash };
}

export function logout(token: string | undefined): void {
  if (token) deleteStaffSession(sha256(token));
}
