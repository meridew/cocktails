import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type NotificationTestResponse } from '$lib/shared';
import { dbTransaction } from '$lib/server/db';
import { body, fail } from '$lib/server/guards';
import { deviceTestPush, notificationPolicy } from '$lib/server/notify';
import {
  endpointForManagement,
  enqueueNotification,
  receiptTokenForDelivery,
} from '$lib/server/notification-store';
import { dispatchShadow } from '$lib/server/push';
import { createRateLimiter } from '$lib/server/ratelimit';

const limiter = createRateLimiter({ max: 3, windowMs: 10 * 60 * 1000 });

/** Send a generic, short-lived push to this exact managed endpoint. */
export async function POST(event: RequestEvent) {
  const b = await body(event);
  const endpointId = cleanStr(b.endpointId, 80);
  const managementToken = cleanStr(b.managementToken, 180);
  if (!endpointId || !managementToken || !endpointForManagement(endpointId, managementToken)) {
    return fail(403, 'invalid endpoint capability');
  }
  if (limiter.isLimited(endpointId)) return fail(429, 'test limit reached; try again later');
  limiter.record(endpointId);

  const result = dbTransaction(() =>
    enqueueNotification({ kind: 'endpoint', endpointId }, deviceTestPush(endpointId)),
  );
  const deliveryId = result.deliveryIds[0];
  if (!deliveryId) return fail(409, 'endpoint is not active');
  if (result.mode === 'shadow') dispatchShadow(result.messageId);
  const ttl = notificationPolicy('device-test').ttlSeconds;
  return json({
    ok: true,
    testId: deliveryId,
    statusToken: receiptTokenForDelivery(deliveryId),
    expiresAt: Date.now() + ttl * 1000,
  } satisfies NotificationTestResponse);
}
