import { json, type RequestEvent } from '@sveltejs/kit';
import { type OkResponse, party } from '$lib/shared';
import { approveStaff } from '$lib/server/auth';
import { staffInEvent } from '$lib/server/db';
import { staffDecisionPush } from '$lib/server/notify';
import { pushToDevice } from '$lib/server/push';
import { denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:approve', party(eventId));
  if (denied(auth)) return auth.denied;

  const target = staffInEvent(eventId, event.params.id!);
  if (!target || !approveStaff(target.id, auth.actor.account?.id ?? null)) {
    return fail(404, 'no pending request');
  }
  // Reach them even if they've pocketed their phone: polling only works while the
  // page is awake, and a browser freezes timers when it isn't.
  if (target.deviceId) void pushToDevice(target.deviceId, staffDecisionPush(true));
  return json({ ok: true } satisfies OkResponse);
}
