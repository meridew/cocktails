import { json, type RequestEvent } from '@sveltejs/kit';
import {
  cleanStr,
  type NotificationDeviceStatus,
  type Platform,
  type PushRegistrationResponse,
  type PushSubscriptionJSON,
  type SubscriberRole,
} from '$lib/shared';
import { sessionStaffContext } from '$lib/server/auth';
import { dbTransaction } from '$lib/server/db';
import { body, fail } from '$lib/server/guards';
import { bearer } from '$lib/server/http';
import {
  deleteManagedEndpoint,
  endpointForManagement,
  refreshManagedEndpoint,
  registerPushEndpoint,
} from '$lib/server/notification-store';
import { isAllowedPushEndpoint } from '$lib/server/push';
import { rateLimitWrites } from '$lib/server/ratelimit';

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

function platformFor(event: RequestEvent): Platform {
  const ua = event.request.headers.get('user-agent') ?? '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) {
    return 'ios';
  }
  return 'web';
}

async function register(event: RequestEvent, replace = false) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;
  const b = await body(event);
  const deviceId = cleanStr(b.deviceId, 80);
  const subscription = parseSubscription(b.subscription);
  if (!deviceId || !subscription) return fail(422, 'invalid subscription');

  if (replace) {
    const previousId = cleanStr(b.endpointId, 80);
    const previousToken = cleanStr(b.managementToken, 180);
    if (!previousId || !previousToken || !endpointForManagement(previousId, previousToken)) {
      return fail(403, 'invalid endpoint capability');
    }
  }

  const bartender = sessionStaffContext(bearer(event));
  const askedRole: SubscriberRole = b.role === 'bartender' ? 'bartender' : 'guest';
  const result = dbTransaction(() => {
    const next = registerPushEndpoint({
      deviceId,
      role: askedRole,
      subscription,
      platform: platformFor(event),
      bartender,
    });
    if (replace) {
      const previousId = cleanStr(b.endpointId, 80);
      const previousToken = cleanStr(b.managementToken, 180);
      if (previousId && previousId !== next.endpointId) {
        deleteManagedEndpoint(previousId, previousToken);
      }
    }
    return next;
  });
  return json({ ok: true, ...result } satisfies PushRegistrationResponse);
}

/** Create or idempotently reconcile an endpoint and one audience. */
export async function POST(event: RequestEvent) {
  return register(event);
}

/** Replace a browser-rotated subscription, authorised by the old endpoint token. */
export async function PUT(event: RequestEvent) {
  return register(event, true);
}

/** Refresh endpoint freshness without resending subscription key material. */
export async function PATCH(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;
  const b = await body(event);
  const endpointId = cleanStr(b.endpointId, 80);
  const token = cleanStr(b.managementToken, 180);
  if (!endpointId || !token || !refreshManagedEndpoint(endpointId, token)) {
    return fail(403, 'invalid endpoint capability');
  }
  return json({ ok: true });
}

/** Remove only the endpoint named by its unguessable management capability. */
export async function DELETE(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;
  const b = await body(event);
  const endpointId = cleanStr(b.endpointId, 80);
  const token = cleanStr(b.managementToken, 180);
  if (!endpointId || !token || !deleteManagedEndpoint(endpointId, token)) {
    return fail(403, 'invalid endpoint capability');
  }
  return json({ ok: true });
}

/** Capability-protected server registration diagnostic for this exact endpoint. */
export async function GET(event: RequestEvent) {
  const endpointId = cleanStr(event.url.searchParams.get('endpointId'), 80);
  const token = cleanStr(event.request.headers.get('x-push-management-token'), 180);
  const endpoint = endpointForManagement(endpointId, token);
  if (!endpoint) return fail(403, 'invalid endpoint capability');
  return json({
    ok: true,
    registered: endpoint.invalidatedAt === null,
    platform: endpoint.platform as Platform,
    lastSeenAt: endpoint.lastSeenAt,
    lastAcceptedAt: endpoint.lastAcceptedAt,
    invalidatedAt: endpoint.invalidatedAt,
  } satisfies NotificationDeviceStatus & { ok: true });
}
