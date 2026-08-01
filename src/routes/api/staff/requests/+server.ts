import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type StaffRequestCreated } from '$lib/shared';
import { requestStaffAccess } from '$lib/server/auth';
import { dbTransaction, eventById, pendingStaffForDevice } from '$lib/server/db';
import { staffRequestPush } from '$lib/server/notify';
import { enqueueNotification } from '$lib/server/notification-store';
import { dispatchShadow } from '$lib/server/push';
import { body, fail } from '$lib/server/guards';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * Ask to work a party's bar — the fallback for when nobody is standing next to you
 * to read out a code. Public: someone asking has no credential yet. The claim secret
 * returned here is what later proves this device made the request.
 *
 * The party is named rather than inferred, for the same reason as `join`: with
 * several running, "whichever is live" queues you at a stranger's bar.
 */
export async function POST(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const b = await body(event);
  const name = cleanStr(b.name, 60);
  const deviceId = cleanStr(b.deviceId, 80);
  const eventId = cleanStr(b.eventId, 40);
  if (!name || !deviceId || !eventId) return fail(422, 'name, deviceId and eventId required');
  if (!eventById(eventId)) return fail(404, 'no such party');

  const result = dbTransaction(() => {
    const claim = requestStaffAccess({ eventId, name, deviceId });
    const request = pendingStaffForDevice(eventId, deviceId);
    const notification = request
      ? enqueueNotification(
          { kind: 'bartenders', eventId },
          staffRequestPush(name, eventId, request.id),
        )
      : null;
    return { claim, notification };
  });
  const { claim, notification } = result;
  if (notification?.mode === 'shadow') dispatchShadow(notification.messageId);
  return json({ ok: true, claim } satisfies StaffRequestCreated);
}
