/**
 * Auth guards and the shared response shapes for the endpoints.
 *
 * These are called at the top of a handler rather than registered as middleware.
 * Hono's `app.use` chain made the guard a property of the route table, several
 * files away from the code it protected; here `requireCapability(event, cap)` sits
 * on the first line of the thing it guards, which is much harder to forget or
 * misread — and `tests/capabilities.test.ts` fails if an endpoint ships without one.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { can, type Capability, type Staff } from '$lib/shared';
import { sessionStaff } from './auth';
import { accounts } from './accounts';
import { bearer } from './http';

/** A handler that failed a guard returns this instead of a value. */
export type Denied = Response;

export const fail = (status: number, error: string): Response =>
  json({ ok: false, error }, { status });

/**
 * Resolve the caller to a staff member, or return the 401 to send back.
 *
 * Returns a union rather than throwing so the happy path stays a plain value and
 * the caller can't accidentally swallow the rejection in a try/catch meant for
 * something else.
 */
export function requireStaff(event: RequestEvent): { staff: Staff } | { denied: Denied } {
  const staff = sessionStaff(bearer(event));
  if (!staff) return { denied: fail(401, 'unauthorized') };
  return { staff };
}

/**
 * As above, but the caller must hold a specific capability.
 *
 * This replaced `requireAdmin`, which encoded the rule as `role !== 'admin'` right
 * here — a second copy of a decision the client was also making. Now both sides
 * read `$lib/shared/permissions`, so a role gaining or losing a power is one edit
 * and the UI follows automatically.
 *
 * 403 rather than 401 when a signed-in bartender asks, so they learn they're
 * authenticated but not permitted, and can't mistake it for an expired session and
 * try to promote themselves by signing in again. The capability is named in the
 * error because it's the useful half: "admin only" doesn't say what was wanted.
 */
export function requireCapability(
  event: RequestEvent,
  capability: Capability,
): { staff: Staff } | { denied: Denied } {
  const staff = sessionStaff(bearer(event));
  if (!staff) return { denied: fail(401, 'unauthorized') };
  if (!can(staff, capability)) return { denied: fail(403, `requires ${capability}`) };
  return { staff };
}

/** A signed-in host account, as Better Auth knows them. */
export interface Account {
  id: string;
  email: string;
  name: string;
}

/**
 * Resolve the caller to a **host account**, rather than to bar staff.
 *
 * This is the bridge the platform was missing: phase 1 gave people accounts and
 * phase 2 gave the app events, but nothing connected them, so signing up led
 * nowhere. Endpoints about *owning* things — creating an event, editing its stock —
 * authenticate this way; endpoints about *working a shift* keep using the staff
 * session, because a helper behind the bar has no account at all.
 *
 * Better Auth reads its own cookie off the request, so there is nothing to parse
 * here and no second session format to keep in step.
 */
export async function requireAccount(
  event: RequestEvent,
): Promise<{ account: Account } | { denied: Denied }> {
  const session = await accounts().api.getSession({ headers: event.request.headers });
  if (!session?.user) return { denied: fail(401, 'sign in to do that') };
  const { id, email, name } = session.user;
  return { account: { id, email, name } };
}

/**
 * Narrowing helper, so call sites read `if (denied(auth)) return auth.denied`.
 * Generic over what succeeded, so it serves both the staff and the account guards.
 */
export const denied = <T extends object>(r: T | { denied: Denied }): r is { denied: Denied } =>
  'denied' in r;

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
