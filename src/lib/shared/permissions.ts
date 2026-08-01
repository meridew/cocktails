/**
 * Who may do what, decided in one place.
 *
 * ## What changed, and why it matters
 *
 * The previous version keyed off a single `staff.role`, and the comment at the top
 * promised that phase 2 would widen the actor to an event membership. It never did,
 * and the consequence was not a missing feature — it was a **misplaced one**. With
 * only one axis, "may edit the cupboard" could only be expressed as "holds a bar
 * session", so the host's stock screen was built inside the bartender's screen,
 * because that was the only place the credential existed. The shape of the app
 * followed the shape of the guard.
 *
 * So there are now two things the old model lacked:
 *
 * 1. **The actor is a pair** — who you are globally, and what you are at a party.
 *    A host *is* staff at their own party; Dan is Admin everywhere *and* behind the
 *    bar locally. Neither fits on one axis.
 * 2. **Every question has a subject.** `stock:edit` asks about a **host**,
 *    `orders:advance` asks about a **party**, `host:suspend` asks about the
 *    **platform**. A capability without a scope is the bug that started all this:
 *    it can only ever mean "holds some credential", which is not a permission.
 *
 * One table, both sides, as before — the server asks `requireCapability` and the
 * client asks `can()`, and they cannot drift because they read the same object.
 */

// ---- the actor -------------------------------------------------------------

/** What someone is, globally. Ours, stored on `user.role`. */
export type AccountRole = 'admin' | 'host';

/** What someone is at one party. */
export type PartyRole = 'owner' | 'staff';

export interface Actor {
  /**
   * Their account, if they have one. **Null for a device-only helper** — the whole
   * appeal of a join code is that it demands nothing be invented or remembered, so
   * a helper genuinely has no account to point at.
   */
  account: { id: string; role: AccountRole } | null;
  /**
   * What they are at the party currently in scope, or null when no party is in
   * scope — signing in, editing a cupboard, listing hosts.
   */
  party: { id: string; role: PartyRole } | null;
}

/** Nobody: a guest, or a caller with no valid credential. Holds nothing, ever. */
export const ANONYMOUS: Actor = { account: null, party: null };

// ---- the subject -----------------------------------------------------------

/**
 * What a capability is being asked *about*.
 *
 * The three kinds are not decoration. "Can this person edit a cupboard" is
 * meaningless until you say **whose**, and answering it without asking is how one
 * host ends up editing another's.
 */
export type Scope =
  /** The service itself — listing hosts, suspending one, granting admin. */
  | { kind: 'platform' }
  /** One party: its queue, its staff, its short list, its lifecycle. */
  | { kind: 'party'; eventId: string }
  /** One person's own things: their cupboard. */
  | { kind: 'host'; userId: string };

export const platform = (): Scope => ({ kind: 'platform' });
export const party = (eventId: string): Scope => ({ kind: 'party', eventId });
export const host = (userId: string): Scope => ({ kind: 'host', userId });

// ---- the capabilities ------------------------------------------------------

export type Capability =
  // The queue. `read` is watching; the rest is working.
  | 'orders:read'
  | 'orders:advance'
  | 'orders:delete'
  | 'orders:clear'
  | 'analytics:read'
  | 'notifications:read'
  | 'notifications:control'
  // Deciding who else gets behind the bar.
  | 'staff:read'
  | 'staff:approve'
  | 'staff:revoke'
  // Who is at the party. A guest is admitted once and pours all night.
  | 'guests:read'
  | 'guests:admit'
  // A host's cupboard — scoped to a person, not a party.
  | 'stock:read'
  | 'stock:edit'
  // The party itself.
  | 'party:create'
  | 'party:edit'
  | 'party:open'
  | 'party:close'
  | 'party:delete'
  | 'menu:curate'
  // The service.
  | 'host:list'
  | 'host:suspend'
  | 'host:delete'
  | 'admin:grant';

/** Every capability, for tests and for the enumeration guard. */
export const CAPABILITIES: readonly Capability[] = [
  'orders:read',
  'orders:advance',
  'orders:delete',
  'orders:clear',
  'analytics:read',
  'notifications:read',
  'notifications:control',
  'staff:read',
  'staff:approve',
  'staff:revoke',
  'guests:read',
  'guests:admit',
  'stock:read',
  'stock:edit',
  'party:create',
  'party:edit',
  'party:open',
  'party:close',
  'party:delete',
  'menu:curate',
  'host:list',
  'host:suspend',
  'host:delete',
  'admin:grant',
];

/** Which subject each capability is a question about. Asking with the wrong one is a bug. */
export const SCOPE_OF: Record<Capability, Scope['kind']> = {
  'orders:read': 'party',
  'orders:advance': 'party',
  'orders:delete': 'party',
  'orders:clear': 'party',
  'analytics:read': 'party',
  'notifications:read': 'party',
  'notifications:control': 'platform',
  'guests:read': 'party',
  'guests:admit': 'party',
  'staff:read': 'party',
  'staff:approve': 'party',
  'staff:revoke': 'party',
  'stock:read': 'host',
  'stock:edit': 'host',
  'party:create': 'platform',
  'party:edit': 'party',
  'party:open': 'party',
  'party:close': 'party',
  'party:delete': 'party',
  'menu:curate': 'party',
  'host:list': 'platform',
  'host:suspend': 'platform',
  'host:delete': 'platform',
  'admin:grant': 'platform',
};

/**
 * What someone working a shift may do — take orders, and nothing else.
 *
 * Notably absent: approving another helper. Dan runs the bar and Dan decides who
 * else is behind it. A helper who could wave in a friend is a helper who can hand
 * out access to a stranger's party.
 */
const STAFF_AT_THIS_PARTY: readonly Capability[] = [
  'orders:read',
  'orders:advance',
  'orders:delete',
  'orders:clear',
  // Letting a guest in is bar work, not host work: whoever is pouring is the one
  // looking at the room, and they already decide whose drink gets made next.
  // Pointedly *not* `staff:approve` — waving in someone who wants a drink is a
  // different thing from waving in someone who wants to work the bar.
  'guests:read',
  'guests:admit',
];

/**
 * What a host may do at their own party: **watch**.
 *
 * They are a customer, not an operator — Dan pours. Curating the short list is here
 * because it is a decision about their own evening, made days beforehand, not an
 * action on the night.
 */
const OWNER_OF_THIS_PARTY: readonly Capability[] = [
  'orders:read',
  'analytics:read',
  'notifications:read',
  'menu:curate',
];

// ---- the question -----------------------------------------------------------

/**
 * Whether this actor holds this capability over this subject.
 *
 * Reads as three questions in order, and the order is the point: **admin first**,
 * because an admin's power doesn't depend on being a member of anything; then the
 * party axis; then the host axis.
 */
export function can(actor: Actor | null | undefined, cap: Capability, scope: Scope): boolean {
  if (!actor) return false;

  // Asking a party question with a platform scope (or vice versa) is a programming
  // error, not a permission decision. Refuse rather than guess — a mismatched scope
  // that quietly returned true would be the widest possible hole.
  if (SCOPE_OF[cap] !== scope.kind) return false;

  // Dan. Everything, anywhere, without being invited to it — which is exactly what
  // "Admin can view and manage all hosts" means, and why he needs no join code.
  if (actor.account?.role === 'admin') return true;

  if (scope.kind === 'party') {
    // Only the party they are actually at. The scope is checked here rather than by
    // the caller because forgetting it is invisible: everything still works, on the
    // wrong party's data.
    if (actor.party?.id !== scope.eventId) return false;
    const held = actor.party.role === 'owner' ? OWNER_OF_THIS_PARTY : STAFF_AT_THIS_PARTY;
    return held.includes(cap);
  }

  if (scope.kind === 'host') {
    // Your own cupboard, and only your own.
    if (!actor.account || actor.account.id !== scope.userId) return false;
    return cap === 'stock:read' || cap === 'stock:edit';
  }

  // Platform: admin only, and admin already returned above.
  return false;
}
