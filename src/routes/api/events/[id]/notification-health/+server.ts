import { json, type RequestEvent } from '@sveltejs/kit';
import { party, type NotificationPartyHealthResponse } from '$lib/shared';
import { eventById } from '$lib/server/db';
import { denied, fail, requireCapability } from '$lib/server/guards';
import {
  notificationDailyHealth,
  notificationHealthSummary,
} from '$lib/server/notification-health';

export async function GET(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'notifications:read', party(eventId));
  if (denied(auth)) return auth.denied;
  const found = eventById(eventId);
  if (!found) return fail(404, 'no such party');
  return json({
    ok: true,
    summary: notificationHealthSummary(found),
    daily: notificationDailyHealth(eventId),
  } satisfies NotificationPartyHealthResponse);
}
