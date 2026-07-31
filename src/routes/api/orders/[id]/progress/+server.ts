import { json, type RequestEvent } from '@sveltejs/kit';
import { party } from '$lib/shared';
import { setItemProgress } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

/**
 * Record how many of one line have been poured.
 *
 * Only the count moves: the name and quantity come from the stored order, so a
 * payload carrying them can't rewrite the drink. The server clamps to the qty.
 */
export async function PATCH(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'orders:advance', party(eventId));
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  const index = typeof b.index === 'number' ? b.index : NaN;
  const made = typeof b.made === 'number' ? b.made : NaN;
  if (!Number.isInteger(index) || index < 0 || !Number.isFinite(made)) {
    return fail(422, 'index and made required');
  }
  const updated = setItemProgress(eventId, event.params.id!, index, made);
  if (!updated) return fail(404, 'not found');
  return json({ ok: true, order: updated });
}
