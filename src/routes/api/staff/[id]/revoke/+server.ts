import { json, type RequestEvent } from '@sveltejs/kit';
import { type OkResponse, party } from '$lib/shared';
import { revokeStaff, staffInEvent } from '$lib/server/db';
import { denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:revoke', party(eventId));
  if (denied(auth)) return auth.denied;

  const target = staffInEvent(eventId, event.params.id!);
  if (!target) return fail(404, 'not found');
  // The "cannot revoke an admin" clause that used to sit here existed to stop
  // somebody locking themselves out of their own bar. It's unnecessary now: access
  // comes from the account, not from this row, so revoking every row at a party
  // takes nobody's bar away — it only ends the shifts.
  revokeStaff(target.id);
  return json({ ok: true } satisfies OkResponse);
}
