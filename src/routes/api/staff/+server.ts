import { json, type RequestEvent } from '@sveltejs/kit';
import type { StaffListResponse } from '$lib/shared';
import { listStaff } from '$lib/server/db';
import { toStaff } from '$lib/server/auth';
import { denied, requireAdmin } from '$lib/server/guards';

export function GET(event: RequestEvent) {
  const auth = requireAdmin(event);
  if (denied(auth)) return auth.denied;
  return json({ ok: true, staff: listStaff().map(toStaff) } satisfies StaffListResponse);
}
