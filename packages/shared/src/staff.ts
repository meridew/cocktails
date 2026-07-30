/**
 * Staff: who can run the bar, and how they got there.
 *
 * Two kinds of principal, deliberately asymmetric:
 *   • admin     — signs in with email + password, so they can get in from ANY
 *                 device (including a fresh one). Seeded from env.
 *   • bartender — a helper whose access was approved for one device. No password
 *                 to invent or remember; if they switch phones, they ask again.
 *
 * A helper's `deviceId` is their *identity*, never their credential: it's sent in
 * every order payload and so isn't secret. The credential is always a
 * server-issued session token.
 */

export type StaffRole = 'admin' | 'bartender';

export const STAFF_ROLES = ['admin', 'bartender'] as const;

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

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

/** Only admins may approve, deny or revoke. */
export const canApproveStaff = (staff: Staff | null): boolean =>
  staff?.role === 'admin' && staff.status === 'active';

// ---- request-to-help flow --------------------------------------------------

export interface StaffRequestInput {
  /** Display name — the whole point is that the admin recognises it. */
  name: string;
  /** Anonymous device id, so the approval can be bound to this device. */
  deviceId: string;
  /** Optional; unverified, so it's a label for recognition, not proof of identity. */
  email?: string;
}

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
