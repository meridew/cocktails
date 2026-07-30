import { json, type RequestEvent } from '@sveltejs/kit';
import { bumpOrder } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/** Push an order to the front of the queue, or put it back in normal order. */
export async function POST(event: RequestEvent) {
  const auth = requireCapability(event, 'orders:advance');
  if (denied(auth)) return auth.denied;
  const b = await body(event);
  // Default to bumping; `{ bumped: false }` restores natural order.
  const updated = bumpOrder(event.params.id!, b.bumped !== false);
  if (!updated) return fail(404, 'not found');
  return json({ ok: true, order: updated });
}
