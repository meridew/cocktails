import { json, type RequestEvent } from '@sveltejs/kit';
import type { NotificationHealthResponse } from '$lib/shared';
import { allEvents, eventsForHost, userById } from '$lib/server/db';
import { fail, whoami } from '$lib/server/guards';
import { notificationHealthSummary } from '$lib/server/notification-health';
import { notificationMode } from '$lib/server/notification-store';
import { pushEnabled } from '$lib/server/push';

/** Cross-party summaries contain aggregates only, never endpoint or guest identity. */
export async function GET(event: RequestEvent) {
  const actor = await whoami(event);
  if (!actor.account) return fail(401, 'sign in to do that');
  const admin = actor.account.role === 'admin';
  const hostId = admin ? event.url.searchParams.get('hostId')?.trim() : actor.account.id;
  if (hostId && !userById(hostId)) return fail(404, 'no such host');
  const events = admin && !hostId ? allEvents() : eventsForHost(hostId!);
  const response: NotificationHealthResponse = {
    ok: true,
    mode: notificationMode(),
    parties: events.map(notificationHealthSummary),
    ...(admin
      ? {
          configuration: {
            enabled: pushEnabled(),
            problem: pushEnabled() ? null : 'VAPID is not configured; pushes cannot be accepted.',
          },
        }
      : {}),
  };
  return json(response);
}
