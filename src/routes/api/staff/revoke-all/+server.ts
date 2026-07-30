import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { revokeAllHelpers } from '$lib/server/db';
import { denied, requireCapability } from '$lib/server/guards';

/** End of the party: every helper loses access at once. Admins are untouched. */
export function POST(event: RequestEvent) {
  const auth = requireCapability(event, 'staff:revoke');
  if (denied(auth)) return auth.denied;
  revokeAllHelpers(auth.staff.eventId);
  return json({ ok: true } satisfies OkResponse);
}
