import { json, type RequestEvent } from '@sveltejs/kit';
import type { ClearWhich, OkResponse } from '$lib/shared';
import { clearOrders } from '$lib/server/db';
import { body, denied, requireCapability } from '$lib/server/guards';

export async function POST(event: RequestEvent) {
  const auth = requireCapability(event, 'orders:clear');
  if (denied(auth)) return auth.denied;
  const b = await body(event);
  // Anything other than an explicit 'all' clears only finished orders — the
  // safe reading of an ambiguous request.
  const which: ClearWhich = b.which === 'all' ? 'all' : 'done';
  clearOrders(auth.staff.eventId, which);
  return json({ ok: true } satisfies OkResponse);
}
