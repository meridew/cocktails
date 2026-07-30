/**
 * Auth guards and the shared response shapes for the endpoints.
 *
 * These are called at the top of a handler rather than registered as middleware.
 * Hono's `app.use` chain made the guard a property of the route table, several
 * files away from the code it protected; here `requireAdmin(event)` sits on the
 * first line of the thing it guards, which is much harder to forget or misread.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import type { Staff } from '$lib/shared';
import { sessionStaff } from './auth';
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
 * As above, but admins only — for deciding who else gets in.
 *
 * 403 rather than 401 when a signed-in bartender asks, so they learn they're
 * authenticated but not permitted, and can't mistake it for an expired session
 * and try to promote themselves by signing in again.
 */
export function requireAdmin(event: RequestEvent): { staff: Staff } | { denied: Denied } {
  const staff = sessionStaff(bearer(event));
  if (!staff) return { denied: fail(401, 'unauthorized') };
  if (staff.role !== 'admin') return { denied: fail(403, 'admin only') };
  return { staff };
}

/** Narrowing helper, so call sites read `if (denied(auth)) return auth.denied`. */
export const denied = (r: { staff: Staff } | { denied: Denied }): r is { denied: Denied } =>
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
