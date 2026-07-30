import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { logout } from '$lib/server/auth';
import { denied, requireStaff } from '$lib/server/guards';
import { bearer } from '$lib/server/http';

export function POST(event: RequestEvent) {
  const auth = requireStaff(event);
  if (denied(auth)) return auth.denied;
  logout(bearer(event));
  return json({ ok: true } satisfies OkResponse);
}
