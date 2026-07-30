import { json, type RequestEvent } from '@sveltejs/kit';
import type { MeResponse } from '$lib/shared';
import { denied, requireStaff } from '$lib/server/guards';

/** Who the current session belongs to — how a reload recovers the role. */
export function GET(event: RequestEvent) {
  const auth = requireStaff(event);
  if (denied(auth)) return auth.denied;
  return json({ ok: true, staff: auth.staff } satisfies MeResponse);
}
