import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { revokeAllHelpers } from '$lib/server/db';
import { denied, requireAdmin } from '$lib/server/guards';

/** End of the party: every helper loses access at once. Admins are untouched. */
export function POST(event: RequestEvent) {
  const auth = requireAdmin(event);
  if (denied(auth)) return auth.denied;
  revokeAllHelpers();
  return json({ ok: true } satisfies OkResponse);
}
