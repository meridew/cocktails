import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, party } from '$lib/shared';
import { admitAllPending, eventById, joinParty } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * Joining a party, and letting everybody in at once.
 *
 * **There is no `GET` here.** There was, briefly, feeding a waiting-room screen that
 * listed pending guests separately — and the screen turned out to be the wrong idea.
 * An un-admitted guest's order sits in the ordinary queue with `newGuest` set, so the
 * bar already has everything it needs from `GET /api/orders` and admits one person by
 * acting on the order in front of them (`POST /api/orders/[id]/admit`).
 *
 * What survives is the asymmetry: anyone may put their hand up, only the bar decides.
 */

/**
 * A guest arrives and gives their name. **Public, and deliberately uninformative.**
 *
 * It answers the same `{ ok: true }` whether the guest is new, waiting or long since
 * admitted, because the requirement was a gate the person being gated cannot
 * perceive. Returning a status would put "you are waiting for approval" one fetch
 * away from any guest who opened dev tools, and the design rests on them not knowing.
 *
 * Idempotent: reopening the app calls this again, and a returning regular must not
 * land back at the start.
 */
export async function POST(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const found = eventById(event.params.id!);
  if (!found) return fail(404, 'no such party');

  const b = await body(event);
  const name = cleanStr(b.name);
  const deviceId = cleanStr(b.deviceId, 80);
  if (!name || !deviceId) return fail(422, 'name and deviceId required');

  joinParty(found.id, deviceId, name);
  return json({ ok: true });
}

/**
 * Let everyone waiting in, in one tap.
 *
 * The per-person case is `POST /api/orders/[id]/admit`, because the bar is looking at
 * a drink rather than at a list of names. This is the other half: a room that arrived
 * together should not cost one tap per person while somebody is trying to pour.
 *
 * Reports how many, so the screen can say something true instead of "done". Never
 * touches `blocked` — a no that was said on purpose is not undone by a bulk button.
 */
export async function PATCH(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'guests:admit', party(eventId));
  if (denied(auth)) return auth.denied;

  return json({ ok: true, admitted: admitAllPending(eventId) });
}
