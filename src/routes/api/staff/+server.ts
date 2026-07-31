import { json, type RequestEvent } from '@sveltejs/kit';
import { type StaffListResponse, party } from '$lib/shared';
import { listStaff } from '$lib/server/db';
import { toStaff } from '$lib/server/auth';
import { denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

export async function GET(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:read', party(eventId));
  if (denied(auth)) return auth.denied;
  return json({
    ok: true,
    staff: listStaff(eventId).map(toStaff),
  } satisfies StaffListResponse);
}
