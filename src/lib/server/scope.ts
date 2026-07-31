/**
 * Which party a request is about.
 *
 * The permission model asks every question about a **subject** (see
 * `$lib/shared/permissions`), so a party-scoped endpoint has to name its party
 * before it can ask anything. This is the one place that decides how.
 *
 * Two sources:
 *
 * 1. **A bar session** — a staff token belongs to exactly one party by construction,
 *    so a helper never has to say which.
 * 2. **`?eventId=`** — how an account-holder with no bar session names a party. Dan
 *    reading a queue from his laptop has a cookie and no staff token.
 *
 * **It deliberately does not read `event.params.id`.** That looks like the obvious
 * third source and is a trap: on `/api/events/[id]/menu` it is the party, and on
 * `/api/orders/[id]` it is the *order*. A helper that read it generically would hand
 * an order id to the permission check as though it were a party — which resolves to
 * no party, denies everyone, and looks like a permissions bug rather than a mix-up.
 * Routes that carry the party in their path pass it in explicitly instead.
 *
 * **Naming a party is not permission to act on it.** This answers "which one";
 * `requireCapability` answers "may you", separately, and always runs. A caller
 * passing somebody else's id gets a 404 — the same answer as for a party that
 * doesn't exist, because a 403 would confirm it's real.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { platform } from '$lib/shared';
import { sessionStaff } from './auth';
import { resolveActor } from './guards';
import { bearer } from './http';

export function partyInScope(event: RequestEvent): string | null {
  const staff = sessionStaff(bearer(event));
  if (staff) return staff.eventId;
  return event.url.searchParams.get('eventId') || null;
}

/**
 * The party, or the right refusal — and *which* refusal is the point.
 *
 * A first cut returned 400 "which party?" whenever none was named, which quietly
 * changed what an anonymous caller sees: every guarded endpoint answers 401, and
 * these started answering 400. That matters twice over. It lets someone with no
 * credential tell endpoints apart by their error codes, and it reports a *missing
 * parameter* for a request that was never going to be allowed regardless — turning
 * an authentication failure into a validation one. The suites caught it.
 *
 * So: no credential at all → **401**, the same as everywhere else. A real caller who
 * simply didn't say which party → **400**, which is genuinely their mistake.
 */
export async function requirePartyInScope(
  event: RequestEvent,
): Promise<{ eventId: string } | { denied: Response }> {
  const eventId = partyInScope(event);
  if (eventId) return { eventId };

  const actor = await resolveActor(event, platform());
  const anonymous = !actor.account && !actor.party;
  return {
    denied: anonymous
      ? json({ ok: false, error: 'unauthorized' }, { status: 401 })
      : json({ ok: false, error: 'which party?' }, { status: 400 }),
  };
}
