import { json, type RequestEvent } from '@sveltejs/kit';
import {
  cleanStr,
  type OkResponse,
  type PushSubscriptionJSON,
  type SubscriberRole,
} from '$lib/shared';
import { deleteSubscriptionsForDevice, saveSubscription } from '$lib/server/db';
import { sessionStaff } from '$lib/server/auth';
import { isAllowedPushEndpoint } from '$lib/server/push';
import { body, fail } from '$lib/server/guards';
import { bearer } from '$lib/server/http';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * Validate a client-supplied Web Push subscription.
 *
 * Both keys are required (web-push needs p256dh to encrypt, and a missing one
 * would be stored and then fail silently at send time), and the endpoint must
 * belong to a real push service — it later becomes a request target from this
 * server, so without an allow-list it's a blind SSRF primitive.
 */
function parseSubscription(raw: unknown): PushSubscriptionJSON | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) return null;
  if (typeof keys !== 'object' || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== 'string' || !p256dh) return null;
  if (typeof auth !== 'string' || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function POST(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const b = await body(event);
  const deviceId = cleanStr(b.deviceId, 80);
  // Only authenticated staff may register for the 'bartender' feed — otherwise
  // anyone could enroll and receive guests' order details by push.
  const role: SubscriberRole =
    b.role === 'bartender' && sessionStaff(bearer(event)) ? 'bartender' : 'guest';
  const subscription = parseSubscription(b.subscription);
  if (!deviceId || !subscription) return fail(422, 'invalid subscription');

  saveSubscription(deviceId, role, subscription);
  return json({ ok: true } satisfies OkResponse);
}

/**
 * Notifications off for this device, every role.
 *
 * "Off" is the absence of a subscription rather than a preference consulted before
 * sending: Web Push is `userVisibleOnly`, so anything delivered *must* be shown,
 * and filtering later would only swap our notification for the browser's own "site
 * updated in the background". The one honest way to send nothing is to have
 * nowhere to send it.
 *
 * Public and keyed on the device id, matching how subscriptions are created: the id
 * isn't secret, and the worst this allows is unsubscribing a device whose id you
 * already know — the safe direction for a mistake to go.
 */
export async function DELETE(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const b = await body(event);
  const deviceId = cleanStr(b.deviceId, 80);
  if (!deviceId) return fail(422, 'deviceId required');
  deleteSubscriptionsForDevice(deviceId);
  return json({ ok: true } satisfies OkResponse);
}
