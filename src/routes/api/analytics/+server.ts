import { json, type RequestEvent } from '@sveltejs/kit';
import { allEvents, eventsForHost, userById } from '$lib/server/db';
import { analyticsSummary } from '$lib/server/analytics';
import { fail, whoami } from '$lib/server/guards';

/** Party summaries only: no attendee names or identifiers cross this boundary. */
export async function GET(event: RequestEvent) {
  const actor = await whoami(event);
  if (!actor.account) return fail(401, 'sign in to do that');

  let events;
  if (actor.account.role === 'admin') {
    const hostId = event.url.searchParams.get('hostId')?.trim();
    if (hostId && !userById(hostId)) return fail(404, 'no such host');
    events = hostId ? eventsForHost(hostId) : allEvents();
  } else {
    events = eventsForHost(actor.account.id);
  }

  return json({ ok: true, parties: events.map(analyticsSummary) });
}
