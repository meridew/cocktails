import { json, type RequestEvent } from '@sveltejs/kit';
import { party } from '$lib/shared';
import { analyticsForEvent } from '$lib/server/analytics';
import { denied, fail, requireCapability } from '$lib/server/guards';

/** Private attendee-level totals for one party. Hosts and Admin only; never staff. */
export async function GET(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'analytics:read', party(eventId));
  if (denied(auth)) return auth.denied;
  const analytics = analyticsForEvent(eventId);
  return analytics ? json({ ok: true, analytics }) : fail(404, 'no such party');
}
