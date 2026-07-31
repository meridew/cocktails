import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, party } from '$lib/shared';
import { admitAllPending, eventById, joinParty, setGuestStatus, waitingRoom } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * Who is at this party, and letting them in.
 *
 * `POST` is the guest joining — **public**, because a guest has no credential and
 * never will. `GET` and `PATCH` are the bar's side of the same table and need
 * `guests:read` / `guests:admit`.
 *
 * The asymmetry is the point: anyone may put their hand up, only the bar decides.
 */

/** The waiting room: pending guests, with what they have ordered. */
export async function GET(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'guests:read', party(eventId));
  if (denied(auth)) return auth.denied;

  return json({ ok: true, waiting: waitingRoom(eventId) });
}

/**
 * A guest arrives and gives their name. **Public, and deliberately uninformative.**
 *
 * It answers the same `{ ok: true }` whether the guest is new, pending or long since
 * admitted, because the requirement was a gate the person being gated cannot
 * perceive. Returning a status here would put "you are waiting for approval" one
 * fetch away from any guest who opened dev tools, and the whole design rests on them
 * not knowing.
 *
 * Idempotent: reopening the app calls this again and a returning regular must not
 * land back in the waiting room.
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
 * The bar lets somebody in — one person, or everyone waiting.
 *
 * `{ all: true }` exists because a room that arrived together should not cost one tap
 * per person while somebody is trying to pour. It reports how many it let in, so the
 * screen can say something true rather than "done".
 *
 * `blocked` is a deliberate no and is never undone by the bulk button.
 */
export async function PATCH(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'guests:admit', party(eventId));
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  if (b.all === true) return json({ ok: true, admitted: admitAllPending(eventId) });

  const deviceId = cleanStr(b.deviceId, 80);
  const status = b.status === 'blocked' ? 'blocked' : 'admitted';
  if (!deviceId) return fail(422, 'deviceId required');

  setGuestStatus(eventId, deviceId, status);
  return json({ ok: true, admitted: status === 'admitted' ? 1 : 0 });
}
