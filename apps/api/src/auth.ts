/**
 * Staff auth — email + password with server-side bearer sessions. Deliberately
 * lightweight (Node built-ins only, on top of node:sqlite): scrypt password
 * hashing + random session tokens (we store only their SHA-256, so a DB leak
 * can't be replayed). Passkeys / social sign-in can layer on later.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Staff } from '@cocktails/shared';
import { config } from './config.ts';
import {
  createStaff,
  createStaffSession,
  deleteStaffSession,
  genId,
  now,
  purgeExpiredSessions,
  staffByEmail,
  staffById,
  staffSession,
  updateStaffPassword,
} from './db.ts';
import { createRateLimiter } from './ratelimit.ts';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
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

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Ensure the env-configured staff account exists with the current password.
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
      email: config.staff.email,
      passwordHash: await hashPassword(config.staff.password),
      role: 'bartender',
    });
    console.log(`\u{1F464} created staff account: ${config.staff.email}`);
  } else if (!(await verifyPassword(config.staff.password, existing.password_hash))) {
    updateStaffPassword(existing.id, await hashPassword(config.staff.password));
    console.log(`\u{1F511} updated staff password: ${config.staff.email}`);
  }
}

/** Verify credentials → issue a session token. Returns null on bad creds. */
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; staff: Staff } | null> {
  const row = staffByEmail(email.trim().toLowerCase());
  if (!row) {
    // Hash anyway so a missing account costs the same as a wrong password —
    // otherwise response timing reveals which emails exist.
    await scryptAsync(password, DUMMY_SALT, KEY_LEN, SCRYPT);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  purgeExpiredSessions();
  const token = randomBytes(32).toString('hex');
  createStaffSession(hashToken(token), row.id, now() + SESSION_TTL_MS);
  return { token, staff: { email: row.email, role: row.role } };
}

/** Brute-force brake on the public login endpoint: counts failures per client IP. */
const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

export function loginBlocked(ip: string): boolean {
  return loginLimiter.isLimited(ip);
}

export function noteLoginAttempt(ip: string, ok: boolean): void {
  if (ok) loginLimiter.clear(ip);
  else loginLimiter.record(ip);
}

/** Resolve a bearer token to a staff member, or null if invalid/expired. */
export function sessionStaff(token: string | undefined): Staff | null {
  if (!token) return null;
  const sess = staffSession(hashToken(token));
  if (!sess || sess.expires_at < now()) return null;
  const row = staffById(sess.staff_id);
  return row ? { email: row.email, role: row.role } : null;
}

export function logout(token: string | undefined): void {
  if (token) deleteStaffSession(hashToken(token));
}
