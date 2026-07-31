import { json, type RequestEvent } from '@sveltejs/kit';
import { party } from '$lib/shared';
import { bumpOrder } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

/** Push an order to the front of the queue, or put it back in normal order. */
export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'orders:advance', party(eventId));
  if (denied(auth)) return auth.denied;
  const b = await body(event);
  // Default to bumping; `{ bumped: false }` restores natural order.
  const updated = bumpOrder(eventId, event.params.id!, b.bumped !== false);
  if (!updated) return fail(404, 'not found');
  return json({ ok: true, order: updated });
}
