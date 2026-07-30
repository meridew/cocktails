import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { approveStaff } from '$lib/server/auth';
import { staffById } from '$lib/server/db';
import { staffDecisionPush } from '$lib/server/notify';
import { pushToDevice } from '$lib/server/push';
import { denied, fail, requireAdmin } from '$lib/server/guards';

export function POST(event: RequestEvent) {
  const auth = requireAdmin(event);
  if (denied(auth)) return auth.denied;

  const target = staffById(event.params.id!);
  if (!target || !approveStaff(target.id, auth.staff.id)) {
    return fail(404, 'no pending request');
  }
  // Reach them even if they've pocketed their phone: polling only works while the
  // page is awake, and a browser freezes timers when it isn't.
  if (target.device_id) void pushToDevice(target.device_id, staffDecisionPush(true));
  return json({ ok: true } satisfies OkResponse);
}
