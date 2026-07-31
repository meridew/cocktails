import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type JoinResponse } from '$lib/shared';
import { joinBlocked, noteJoinAttempt, redeemJoinCode } from '$lib/server/auth';
import { eventById } from '$lib/server/db';
import { body, fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';

/**
 * Redeem a join code. Public, because someone joining has no credential yet, and
 * throttled hard for the same reason as the keypad — it's a 6-digit keyspace.
 *
 * **The party is named, not inferred.** This used to call `ensureLiveEvent()`, which
 * meant a helper joined "whichever party is live" — right while there was one, and
 * silently wrong the moment two ran at once. They reach this from a party's own
 * screen, so the id is to hand.
 */
export async function POST(event: RequestEvent) {
  const ip = clientIp(event);
  if (joinBlocked(ip)) return fail(429, 'too many attempts — try again later');

  const b = await body(event);
  const code = typeof b.code === 'string' ? b.code : '';
  const name = cleanStr(b.name, 60);
  const deviceId = cleanStr(b.deviceId, 80);
  const eventId = cleanStr(b.eventId, 40);
  if (!name || !deviceId || !eventId) {
    // Shape problems still count towards the throttle — a flood of them is exactly
    // what it's for — they just don't get a distinct error to probe with.
    noteJoinAttempt(ip, false);
    return fail(422, 'name, deviceId and eventId required');
  }
  // A code is only ever valid for the party it was minted at; a wrong id and a wrong
  // code get the same answer, so neither confirms the other.
  const result = eventById(eventId) ? redeemJoinCode(eventId, code, name, deviceId) : null;
  noteJoinAttempt(ip, !!result);
  if (!result) return fail(401, 'that code is wrong or has expired');
  return json({ ok: true, token: result.token, staff: result.staff } satisfies JoinResponse);
}
