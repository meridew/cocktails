/**
 * Staff auth — email + password with server-side bearer sessions. Deliberately
 * lightweight (Node built-ins only, on top of node:sqlite): scrypt password
 * hashing + random session tokens (we store only their SHA-256, so a DB leak
 * can't be replayed). Replaces the old shared PIN. Passkeys / social can layer
 * on after the public-HTTPS cutover.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DUMMY_SALT = randomBytes(16); // constant-time "no such user" path

/** `salt:hash` (hex). scrypt is intentionally slow — a built-in brute-force brake. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Ensure the env-configured staff account exists with the current password.
 * Env is the source of truth, so changing STAFF_PASSWORD and redeploying just
 * applies — no re-seed dance. (Add a change-password UI later if self-service
 * is wanted.)
 */
export function seedStaff(): void {
  if (!config.staff.email || !config.staff.password) return;
  const existing = staffByEmail(config.staff.email);
  if (!existing) {
    createStaff({
      id: genId(),
      email: config.staff.email,
      passwordHash: hashPassword(config.staff.password),
      role: 'bartender',
    });
    console.log(`\u{1F464} created staff account: ${config.staff.email}`);
  } else if (!verifyPassword(config.staff.password, existing.password_hash)) {
    updateStaffPassword(existing.id, hashPassword(config.staff.password));
    console.log(`\u{1F511} updated staff password: ${config.staff.email}`);
  }
}

/** Verify credentials → issue a session token. Returns null on bad creds. */
export function login(email: string, password: string): { token: string; staff: Staff } | null {
  const row = staffByEmail(email.trim().toLowerCase());
  if (!row) {
    scryptSync(password, DUMMY_SALT, 64); // equalize timing → no username oracle
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  purgeExpiredSessions();
  const token = randomBytes(32).toString('hex');
  createStaffSession(hashToken(token), row.id, now() + SESSION_TTL_MS);
  return { token, staff: { email: row.email, role: row.role } };
}

// ---- login throttle (per client IP) — a brute-force brake on the public endpoint.
const loginHits = new Map<string, { n: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

export function loginBlocked(ip: string): boolean {
  const r = loginHits.get(ip);
  return !!r && r.resetAt > now() && r.n >= LOGIN_MAX;
}
export function noteLoginAttempt(ip: string, ok: boolean): void {
  if (ok) {
    loginHits.delete(ip);
    return;
  }
  const r = loginHits.get(ip);
  if (!r || r.resetAt <= now()) loginHits.set(ip, { n: 1, resetAt: now() + LOGIN_WINDOW_MS });
  else r.n += 1;
  if (loginHits.size > 5000) {
    for (const [k, v] of loginHits) if (v.resetAt <= now()) loginHits.delete(k);
  }
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
