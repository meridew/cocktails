import { json, type RequestEvent } from '@sveltejs/kit';
import type { ClearWhich, OkResponse } from '$lib/shared';
import { clearOrders } from '$lib/server/db';
import { body, denied, requireStaff } from '$lib/server/guards';

export async function POST(event: RequestEvent) {
  const auth = requireStaff(event);
  if (denied(auth)) return auth.denied;
  const b = await body(event);
  // Anything other than an explicit 'all' clears only finished orders — the
  // safe reading of an ambiguous request.
  const which: ClearWhich = b.which === 'all' ? 'all' : 'done';
  clearOrders(which);
  return json({ ok: true } satisfies OkResponse);
}
