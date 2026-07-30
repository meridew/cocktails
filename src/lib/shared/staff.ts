/**
 * Staff: who can run the bar, and how they got there.
 *
 * Two kinds of principal, deliberately asymmetric:
 *   • admin     — signs in from ANY device (including a fresh one), normally with
 *                 a short PIN. Seeded from env.
 *   • bartender — a helper whose access was approved for one device. No password
 *                 to invent or remember; if they switch phones, they ask again.
 *
 * A helper's `deviceId` is their *identity*, never their credential: it's sent in
 * every order payload and so isn't secret. The credential is always a
 * server-issued session token.
 */

/**
 * Digits in the admin PIN. Short on purpose — it's tapped on a phone behind the
 * bar, repeatedly, by someone holding a cocktail shaker. A 6-digit space is only
 * 10^6, so the security comes from throttling (per-IP *and* global) rather than
 * from length; see the limiters in the API's auth module.
 */
export const PIN_LENGTH = 6;

/** Digits only, exactly PIN_LENGTH of them. Shared so both sides agree. */
export function isValidPin(v: unknown): v is string {
  return typeof v === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(v);
}

/**
 * A join code is the same shape as the PIN — same keypad, same muscle memory —
 * but a different credential: short-lived, revocable, and it only ever grants
 * `bartender`. The host reads it out; the helper is in immediately.
 */
export const JOIN_CODE_LENGTH = PIN_LENGTH;

export const isValidJoinCode = isValidPin;

/** How long a join code stays usable. One code comfortably onboards a shift. */
export const JOIN_CODE_TTL_MS = 15 * 60 * 1000;

export type StaffRole = 'admin' | 'bartender';

/**
 * `pending` — asked to help, waiting on an admin.
 * `active`  — can use the bar.
 * `revoked` — kept for the record, but sessions are killed and sign-in refused.
 */
export type StaffStatus = 'pending' | 'active' | 'revoked';

/** A staff member as the client sees them. Never carries secrets. */
export interface Staff {
  id: string;
  /** What the admin actually recognises in the list. Always present. */
  name: string;
  /** Required for admins (they sign in with it); optional for helpers. */
  email: string | null;
  role: StaffRole;
  status: StaffStatus;
  /** epoch ms */
  createdAt: number;
}

// Who may approve, deny or revoke now lives in ./permissions, alongside every
// other such rule, so the server guard and the UI cannot disagree about it.

// ---- request-to-help flow --------------------------------------------------

/**
 * Returned once when a request is created. `claim` is a one-time secret the
 * device keeps in order to collect its session after approval — without it,
 * knowing a (non-secret) deviceId would be enough to steal someone's approval.
 */
export interface StaffRequestCreated {
  ok: true;
  claim: string;
}

/** Polled with the claim secret until an admin decides. */
export type StaffClaimResponse =
  | { ok: true; status: 'pending' }
  | { ok: true; status: 'denied' }
  | { ok: true; status: 'active'; token: string; staff: Staff };

export interface StaffListResponse {
  ok: true;
  staff: Staff[];
}

// ---- join codes ------------------------------------------------------------

/** Returned to the host when they mint a code. The plaintext is shown once. */
export interface JoinCodeResponse {
  ok: true;
  code: string;
  /** epoch ms */
  expiresAt: number;
}

/** What a helper sends to redeem a code, and what they get back. */
export interface JoinResponse {
  ok: true;
  token: string;
  staff: Staff;
}
