/**
 * One way in, for every endpoint.
 *
 * ## Why this is one function and not three
 *
 * There used to be `requireStaff`, `requireCapability` and `requireAccount`, and an
 * endpoint picked one. That sounds like a detail and wasn't: it meant an endpoint's
 * *shape* was decided by which credential it happened to understand. The host's
 * cupboard could only be edited by something holding a bar session, so the cupboard
 * screen was built inside the bar. The guard chose the architecture.
 *
 * Now there is one guard. It resolves whoever is calling — a signed-in account, a
 * bar session, or nobody — into an `Actor`, and asks the shared permission table.
 * Endpoints no longer know or care which kind of caller they have, which is what
 * lets each one live where it belongs.
 *
 * ## The two credentials
 *
 * **An account cookie** (Better Auth) says who you are globally. **A bearer staff
 * token** says which party you are working. They are not alternatives — a staff row
 * linked to a `userId` carries both, which is how the keypad returns Dan to the bar
 * *as himself*, with his admin capabilities, without a second session system.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { ANONYMOUS, can, type Actor, type Capability, type Scope } from '$lib/shared';
import { sessionStaff } from './auth';
import { accounts } from './accounts';
import { config } from './config';
import { eventById, userById } from './db';
import { bearer } from './http';

/** A handler that failed a guard returns this instead of a value. */
export type Denied = Response;

export const fail = (status: number, error: string): Response =>
  json({ ok: false, error }, { status });

/**
 * The account role, with config outranking the database.
 *
 * `ADMIN_EMAILS` is re-read on every resolution rather than written once at boot, so
 * the file on the Mac is the truth. An edit made inside the app — a mis-click on
 * "remove admin", a bad migration — cannot lock the operator out of their own
 * service, because the next request re-asserts it.
 */
function roleOf(u: { email: string; role: string }): 'admin' | 'host' {
  if (config.adminEmails.includes(u.email.trim().toLowerCase())) return 'admin';
  return u.role === 'admin' ? 'admin' : 'host';
}

/**
 * A suspended account is nobody.
 *
 * Checked once here rather than at each endpoint, so a ban takes effect everywhere
 * the moment it is set — including on a session issued before it.
 */
const usable = <T extends { bannedAt: number | null }>(u: T | null): T | null =>
  u && u.bannedAt === null ? u : null;

/**
 * Who is calling, and what they are at the party in question.
 *
 * The scope is a parameter because the party half of an actor cannot be known
 * without it: "owner" is a fact about a *particular* event. Resolving membership
 * against the scope here, rather than trusting the caller to check it later, is what
 * makes a forgotten check impossible rather than merely unlikely.
 */
export async function resolveActor(event: RequestEvent, scope: Scope): Promise<Actor> {
  const actor: Actor = { account: null, party: null };

  // --- the account half -----------------------------------------------------
  const session = await accounts()
    .api.getSession({ headers: event.request.headers })
    .catch(() => null);
  let accountId: string | null = null;
  if (session?.user) {
    const row = usable(userById(session.user.id));
    if (row) {
      accountId = row.id;
      actor.account = { id: row.id, role: roleOf(row) };
    }
  }

  // --- the party half -------------------------------------------------------
  const staff = sessionStaff(bearer(event));
  if (staff && !actor.account && staff.userId) {
    // A bar session on a device that never signed in with a cookie — the keypad
    // path. The staff row names the account, so the account role comes with it.
    const row = usable(userById(staff.userId));
    if (row) {
      accountId = row.id;
      actor.account = { id: row.id, role: roleOf(row) };
    }
  }

  if (scope.kind === 'party') {
    const party = eventById(scope.eventId);
    if (party) {
      if (accountId && party.hostUserId === accountId) {
        actor.party = { id: party.id, role: 'owner' };
      } else if (staff && staff.eventId === party.id && staff.status === 'active') {
        actor.party = { id: party.id, role: 'staff' };
      }
    }
  }

  return actor;
}

export interface Allowed {
  actor: Actor;
}

/**
 * The only guard. `if (denied(auth)) return auth.denied;` on the first line of a
 * handler, and `tests/capabilities.test.ts` fails any endpoint that skips it.
 *
 * **401 when there is no credential at all, 403 when there is one and it isn't
 * enough** — so a helper who can't clear a queue learns they are signed in and not
 * permitted, rather than mistaking it for an expired session and signing in again to
 * no effect. The capability is named in the message because "admin only" doesn't say
 * what was wanted.
 *
 * A party scope whose event doesn't exist is **404**, and so is one belonging to
 * somebody else — the id must not confirm the party is real. That asymmetry is the
 * whole of the tenancy suite.
 */
export async function requireCapability(
  event: RequestEvent,
  capability: Capability,
  scope: Scope,
): Promise<Allowed | { denied: Denied }> {
  const actor = await resolveActor(event, scope);

  if (scope.kind === 'party' && !eventById(scope.eventId)) {
    return { denied: fail(404, 'no such party') };
  }

  if (can(actor, capability, scope)) return { actor };

  /**
   * **Did they present a credential at all** — not "do they have an actor for this
   * scope". The two came apart the first time this was written: a helper holding a
   * perfectly valid bar session got 401 from a host-scoped endpoint, because the
   * party half of an actor is only resolved for a party scope, so they looked
   * anonymous. `api.ts` reads 401 as "your session expired" and signs the holder
   * out — so a stray request would have thrown a bartender off the queue they were
   * working, mid-service.
   */
  const authenticated = Boolean(actor.account) || sessionStaff(bearer(event)) !== null;
  if (!authenticated) return { denied: fail(401, 'unauthorized') };

  // Signed in as somebody, but not somebody with a claim on this. For a party or a
  // host they don't belong to, 404 rather than 403: a 403 confirms it exists.
  if (scope.kind === 'party' && actor.party === null) return { denied: fail(404, 'no such party') };
  if (scope.kind === 'host' && actor.account?.id !== scope.userId) {
    return { denied: fail(404, 'no such host') };
  }
  return { denied: fail(403, `requires ${capability}`) };
}

/**
 * Narrowing helper, so call sites read `if (denied(auth)) return auth.denied`.
 * Generic over what succeeded, so it serves anything that can be refused.
 */
export const denied = <T extends object>(r: T | { denied: Denied }): r is { denied: Denied } =>
  'denied' in r;

/** Who is calling, with no permission question attached — for `/api/auth/me`. */
export const whoami = (event: RequestEvent): Promise<Actor> =>
  resolveActor(event, { kind: 'platform' });

/** The anonymous actor, exported so callers can compare against it meaningfully. */
export { ANONYMOUS };

/**
 * Parse a JSON body without ever throwing.
 *
 * A malformed body must surface as the endpoint's own validation error, not as a
 * 500 — an unauthenticated caller can send anything, and a stack trace in the log
 * for every junk request is noise that hides real faults.
 */
export async function body(event: RequestEvent): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await event.request.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
