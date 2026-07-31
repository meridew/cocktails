import { json, type RequestEvent } from '@sveltejs/kit';
import { type JoinCodeResponse, type OkResponse, party } from '$lib/shared';
import { createJoinCode } from '$lib/server/auth';
import { clearJoinCodes } from '$lib/server/db';
import { denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

/** The host mints a code and reads it out to whoever is standing next to them. */
export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:invite', party(eventId));
  if (denied(auth)) return auth.denied;
  const { code, expiresAt } = createJoinCode(auth.actor.account?.id ?? null);
  return json({ ok: true, code, expiresAt } satisfies JoinCodeResponse);
}

/**
 * "Stop sharing" — invalidates every outstanding code. Deliberately separate from
 * revoking helpers, who keep working: closing the door shouldn't evict the people
 * already inside.
 */
export async function DELETE(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:invite', party(eventId));
  if (denied(auth)) return auth.denied;
  clearJoinCodes();
  return json({ ok: true } satisfies OkResponse);
}
