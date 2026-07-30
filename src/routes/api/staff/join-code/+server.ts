import { json, type RequestEvent } from '@sveltejs/kit';
import type { JoinCodeResponse, OkResponse } from '$lib/shared';
import { createJoinCode } from '$lib/server/auth';
import { clearJoinCodes } from '$lib/server/db';
import { denied, requireCapability } from '$lib/server/guards';

/** The host mints a code and reads it out to whoever is standing next to them. */
export function POST(event: RequestEvent) {
  const auth = requireCapability(event, 'staff:invite');
  if (denied(auth)) return auth.denied;
  const { code, expiresAt } = createJoinCode(auth.staff.id);
  return json({ ok: true, code, expiresAt } satisfies JoinCodeResponse);
}

/**
 * "Stop sharing" — invalidates every outstanding code. Deliberately separate from
 * revoking helpers, who keep working: closing the door shouldn't evict the people
 * already inside.
 */
export function DELETE(event: RequestEvent) {
  const auth = requireCapability(event, 'staff:invite');
  if (denied(auth)) return auth.denied;
  clearJoinCodes();
  return json({ ok: true } satisfies OkResponse);
}
