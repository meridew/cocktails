import { json, type RequestEvent } from '@sveltejs/kit';
import { type OkResponse, party } from '$lib/shared';
import { approveStaff } from '$lib/server/auth';
import { dbTransaction, staffInEvent } from '$lib/server/db';
import { staffDecisionPush } from '$lib/server/notify';
import { enqueueNotification } from '$lib/server/notification-store';
import { dispatchShadow } from '$lib/server/push';
import { denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:approve', party(eventId));
  if (denied(auth)) return auth.denied;

  const result = dbTransaction(() => {
    const target = staffInEvent(eventId, event.params.id!);
    if (!target || !approveStaff(target, auth.actor.account?.id ?? null)) return null;
    const notification = target.deviceId
      ? enqueueNotification(
          { kind: 'device', deviceId: target.deviceId },
          staffDecisionPush(true, eventId, target.id),
        )
      : null;
    return { notification };
  });
  if (!result) {
    return fail(404, 'no pending request');
  }
  if (result.notification?.mode === 'shadow') dispatchShadow(result.notification.messageId);
  return json({ ok: true } satisfies OkResponse);
}
