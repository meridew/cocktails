import { json, type RequestEvent } from '@sveltejs/kit';
import { type OkResponse, party } from '$lib/shared';
import { revokeAllHelpers } from '$lib/server/db';
import { sessionStaff } from '$lib/server/auth';
import { denied, requireCapability } from '$lib/server/guards';
import { bearer } from '$lib/server/http';
import { requirePartyInScope } from '$lib/server/scope';

/**
 * End of the night: every helper loses access at once.
 *
 * **Except whoever tapped it.** There is no role to exempt them by any more, so the
 * exemption is their own shift — which is what the control has always meant. Without
 * it, ending the night signs the person ending it out of the bar they are standing
 * behind.
 */
export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:revoke', party(eventId));
  if (denied(auth)) return auth.denied;

  revokeAllHelpers(eventId, sessionStaff(bearer(event))?.id ?? null);
  return json({ ok: true } satisfies OkResponse);
}
