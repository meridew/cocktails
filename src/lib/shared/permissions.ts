/**
 * Who may do what, decided in one place.
 *
 * The rule used to be written twice: server-side as `staff.role !== 'admin'` in a
 * guard, and client-side as `canApproveStaff()` to decide whether to render the
 * button. They agreed, but nothing made them keep agreeing — and the failure mode
 * is silent, because a UI that offers an action the server refuses looks like a bug
 * in the action rather than in the permission.
 *
 * So: one table, both sides. The server asks `requireCapability(event, cap)` and
 * the client asks `can(staff, cap)`, and they cannot drift because they are reading
 * the same object.
 *
 * **Phase 2 widens the subject, not the shape.** Today the actor is a `Staff` row
 * with a global role. Once events exist, capabilities come from the *pair* of
 * account role and event role, and `can()` takes a membership instead. Call sites
 * are already written against the capability rather than the role, so they don't
 * change when that happens — which is the reason for doing this before tenancy
 * rather than after.
 */
import type { Staff, StaffRole } from './staff';

export type Capability =
  // The queue.
  | 'orders:read'
  | 'orders:advance'
  | 'orders:delete'
  | 'orders:clear'
  // Deciding who else gets behind the bar.
  | 'staff:read'
  | 'staff:approve'
  | 'staff:revoke'
  | 'staff:invite'
  // The host's stock list — phase 3 wires these to endpoints.
  | 'inventory:read'
  | 'inventory:edit'
  // Events themselves — phase 2.
  | 'event:create'
  | 'event:edit';

/**
 * What a bartender may do: run the service, but not decide who else runs it.
 *
 * Deliberately includes `orders:delete` and `orders:clear`, matching today's
 * behaviour where any signed-in helper can tidy the queue. Clearing a queue is
 * recoverable and mid-party it is exactly what a helper needs; approving staff is
 * neither.
 */
const BARTENDER: readonly Capability[] = [
  'orders:read',
  'orders:advance',
  'orders:delete',
  'orders:clear',
  'inventory:read',
];

/** An admin is the host or Dan: everything, including who else gets in. */
const ADMIN: readonly Capability[] = [
  ...BARTENDER,
  'staff:read',
  'staff:approve',
  'staff:revoke',
  'staff:invite',
  'inventory:edit',
  'event:create',
  'event:edit',
];

const BY_ROLE: Record<StaffRole, readonly Capability[]> = {
  admin: ADMIN,
  bartender: BARTENDER,
};

/**
 * Whether this actor holds a capability.
 *
 * A revoked or still-pending person holds nothing, whatever their role says —
 * status is checked first so a revoked admin cannot act on a stale session.
 */
export function can(actor: Pick<Staff, 'role' | 'status'> | null | undefined, cap: Capability) {
  if (!actor || actor.status !== 'active') return false;
  return BY_ROLE[actor.role].includes(cap);
}

/** Every capability, for tests that need to enumerate them. */
export const CAPABILITIES: readonly Capability[] = ADMIN;
