import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type JoinResponse } from '$lib/shared';
import { ensureLiveEvent, joinBlocked, noteJoinAttempt, redeemJoinCode } from '$lib/server/auth';
import { body, fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';

/**
 * Redeem a join code. Public, because someone joining has no credential yet, and
 * throttled hard for the same reason as the PIN — it's a 6-digit keyspace.
 */
export async function POST(event: RequestEvent) {
  const ip = clientIp(event);
  if (joinBlocked(ip)) return fail(429, 'too many attempts — try again later');

  const b = await body(event);
  const code = typeof b.code === 'string' ? b.code : '';
  const name = cleanStr(b.name, 60);
  const deviceId = cleanStr(b.deviceId, 80);
  if (!name || !deviceId) {
    // Shape problems still count towards the throttle — a flood of them is exactly
    // what it's for — they just don't get a distinct error to probe with.
    noteJoinAttempt(ip, false);
    return fail(422, 'name and deviceId required');
  }
  const result = redeemJoinCode(ensureLiveEvent(), code, name, deviceId);
  noteJoinAttempt(ip, !!result);
  if (!result) return fail(401, 'that code is wrong or has expired');
  return json({ ok: true, token: result.token, staff: result.staff } satisfies JoinResponse);
}
