import { json, type RequestEvent } from '@sveltejs/kit';
import type { StaffClaimResponse } from '$lib/shared';
import { claimBlocked, claimStaffAccess, noteClaimAttempt } from '$lib/server/auth';
import { body, fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';

/** Exchange a claim secret for the host's decision. */
export async function POST(event: RequestEvent) {
  const ip = clientIp(event);
  if (claimBlocked(ip)) return fail(429, 'slow down');
  noteClaimAttempt(ip);

  const b = await body(event);
  const claim = typeof b.claim === 'string' ? b.claim : '';
  return json({ ok: true, ...claimStaffAccess(claim) } satisfies StaffClaimResponse);
}
