import { json, type RequestEvent } from '@sveltejs/kit';
import { type OkResponse, party } from '$lib/shared';
import { deleteStaff, staffInEvent } from '$lib/server/db';
import { staffDecisionPush } from '$lib/server/notify';
import { pushToDevice } from '$lib/server/push';
import { denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';

/**
 * Deny a request, or remove a helper entirely.
 *
 * Denying removes the row outright: there's nothing worth keeping about a request
 * that was never granted, and it keeps the host's list clean.
 */
export async function DELETE(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;
  const auth = await requireCapability(event, 'staff:revoke', party(eventId));
  if (denied(auth)) return auth.denied;

  const target = staffInEvent(eventId, event.params.id!);
  if (!target) return fail(404, 'not found');
  // There used to be a "cannot remove an admin" clause here. It's gone with the
  // role column: nobody in this table outranks anybody else, and the person who
  // used to need protecting holds an account whose access doesn't come from a row
  // in it. Removing every staff row at a party now locks nobody out of anything.

  deleteStaff(target.id);
  // Only a *pending* row was waiting on an answer; removing an established helper
  // isn't a decision they asked for, so it shouldn't ping them.
  if (target.status === 'pending' && target.deviceId) {
    void pushToDevice(target.deviceId, staffDecisionPush(false));
  }
  return json({ ok: true } satisfies OkResponse);
}
