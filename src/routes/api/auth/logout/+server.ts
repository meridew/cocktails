import { json, type RequestEvent } from '@sveltejs/kit';
import type { OkResponse } from '$lib/shared';
import { logout } from '$lib/server/auth';
import { bearer } from '$lib/server/http';

/**
 * Give up a bar session.
 *
 * Unconditional on purpose: logging out asks for nothing, and refusing an already
 * expired token would leave a client holding a credential it can't shed. Account
 * sign-out is Better Auth's own at `/api/account/sign-out` — different credential,
 * different door.
 */
export function POST(event: RequestEvent) {
  logout(bearer(event));
  return json({ ok: true } satisfies OkResponse);
}
