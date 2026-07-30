import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { deleteStaff, staffById } from '$lib/server/db';
import { staffDecisionPush } from '$lib/server/notify';
import { pushToDevice } from '$lib/server/push';
import { denied, fail, requireAdmin } from '$lib/server/guards';

/**
 * Deny a request, or remove a helper entirely.
 *
 * Denying removes the row outright: there's nothing worth keeping about a request
 * that was never granted, and it keeps the host's list clean.
 */
export function DELETE(event: RequestEvent) {
  const auth = requireAdmin(event);
  if (denied(auth)) return auth.denied;

  const target = staffById(event.params.id!);
  if (!target) return fail(404, 'not found');
  if (target.role === 'admin') return fail(403, 'cannot remove an admin');

  deleteStaff(target.id);
  // Only a *pending* row was waiting on an answer; removing an established helper
  // isn't a decision they asked for, so it shouldn't ping them.
  if (target.status === 'pending' && target.deviceId) {
    void pushToDevice(target.deviceId, staffDecisionPush(false));
  }
  return json({ ok: true } satisfies OkResponse);
}
