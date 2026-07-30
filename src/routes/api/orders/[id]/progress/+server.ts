import { json, type RequestEvent } from '@sveltejs/kit';
import { setItemProgress } from '$lib/server/db';
import { body, denied, fail, requireStaff } from '$lib/server/guards';

/**
 * Record how many of one line have been poured.
 *
 * Only the count moves: the name and quantity come from the stored order, so a
 * payload carrying them can't rewrite the drink. The server clamps to the qty.
 */
export async function PATCH(event: RequestEvent) {
  const auth = requireStaff(event);
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  const index = typeof b.index === 'number' ? b.index : NaN;
  const made = typeof b.made === 'number' ? b.made : NaN;
  if (!Number.isInteger(index) || index < 0 || !Number.isFinite(made)) {
    return fail(422, 'index and made required');
  }
  const updated = setItemProgress(event.params.id!, index, made);
  if (!updated) return fail(404, 'not found');
  return json({ ok: true, order: updated });
}
