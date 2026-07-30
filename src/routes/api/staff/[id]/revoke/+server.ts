import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { revokeStaff, staffInEvent } from '$lib/server/db';
import { denied, fail, requireCapability } from '$lib/server/guards';

export function POST(event: RequestEvent) {
  const auth = requireCapability(event, 'staff:revoke');
  if (denied(auth)) return auth.denied;

  const target = staffInEvent(auth.staff.eventId, event.params.id!);
  if (!target) return fail(404, 'not found');
  // Guarding this is what stops an admin locking themselves out of their own bar.
  if (target.role === 'admin') return fail(403, 'cannot revoke an admin');
  revokeStaff(target.id);
  return json({ ok: true } satisfies OkResponse);
}
