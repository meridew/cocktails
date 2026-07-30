import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type StaffRequestCreated } from '$lib/shared';
import { requestStaffAccess } from '$lib/server/auth';
import { staffRequestPush } from '$lib/server/notify';
import { pushToRole } from '$lib/server/push';
import { body, fail } from '$lib/server/guards';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * Ask the host for access — the fallback for when they aren't standing next to you.
 * Public: someone asking to help has no credential yet. The claim secret returned
 * here is what later proves this device made the request.
 */
export async function POST(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const b = await body(event);
  const name = cleanStr(b.name, 60);
  const deviceId = cleanStr(b.deviceId, 80);
  if (!name || !deviceId) return fail(422, 'name and deviceId required');

  const claim = requestStaffAccess({ name, deviceId });
  // Tell the host somebody is waiting. Without this the request surfaces only as a
  // small dot on a menu button, which is most of why waiting felt like a void.
  void pushToRole('bartender', staffRequestPush(name));
  return json({ ok: true, claim } satisfies StaffRequestCreated);
}
