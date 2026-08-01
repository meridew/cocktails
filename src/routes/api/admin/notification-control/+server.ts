import { json, type RequestEvent } from '@sveltejs/kit';
import { isNotificationMode, platform } from '$lib/shared';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { notificationMode, setNotificationMode } from '$lib/server/notification-store';

export async function GET(event: RequestEvent) {
  const auth = await requireCapability(event, 'notifications:control', platform());
  if (denied(auth)) return auth.denied;
  return json({ ok: true, mode: notificationMode() });
}

export async function PUT(event: RequestEvent) {
  const auth = await requireCapability(event, 'notifications:control', platform());
  if (denied(auth)) return auth.denied;
  const b = await body(event);
  if (!isNotificationMode(b.mode)) return fail(422, 'invalid notification mode');
  setNotificationMode(b.mode, auth.actor.account!.id);
  return json({ ok: true, mode: b.mode });
}
