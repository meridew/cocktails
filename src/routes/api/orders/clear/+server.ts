import { json, type RequestEvent } from '@sveltejs/kit';
import { party, type ClearWhich, type OkResponse } from '$lib/shared';
import { clearOrders } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'orders:clear', party(eventId));
  if (denied(auth)) return auth.denied;
  const b = await body(event);
  // Anything other than an explicit 'all' clears only finished orders — the
  // safe reading of an ambiguous request.
  const which: ClearWhich = b.which === 'all' ? 'all' : 'done';
  clearOrders(eventId, which);
  return json({ ok: true } satisfies OkResponse);
}
