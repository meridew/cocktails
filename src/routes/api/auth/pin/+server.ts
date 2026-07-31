import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, isValidPin, type LoginResponse } from '$lib/shared';
import { notePinAttempt, pinBlocked, signInWithPin } from '$lib/server/auth';
import { body, fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';

/**
 * Get back behind the bar with the keypad.
 *
 * **This proves you are still you; it does not work out who you are.** The device
 * signed in properly once and remembers whose it is, so it sends the account id.
 * That id is not a secret — the throttle is what protects the six digits after it,
 * per-IP *and* per-account, so guessing at one person's code cannot exhaust
 * everybody else's allowance.
 *
 * What comes back is a bar session for one party, carrying the account behind it via
 * `staff.userId` — so the holder gets their own capabilities rather than a generic
 * shift's. See `resolveActor`, and PLATFORM-PLAN §8 phase 0.7 for why it isn't an
 * account session.
 *
 * A wrong PIN, an account with no PIN set, and an account that isn't working that
 * party all return the same 401, so none of the three can be enumerated here.
 */
export async function POST(event: RequestEvent) {
  const ip = clientIp(event);
  const b = await body(event);
  const pin = typeof b.pin === 'string' ? b.pin : '';
  const userId = cleanStr(b.userId, 64);
  const eventId = cleanStr(b.eventId, 40);

  if (pinBlocked(ip, userId)) return fail(429, 'too many attempts — try again later');
  if (!userId || !eventId) return fail(422, 'userId and eventId required');

  // Shape-check before paying for the hash, but still count it: a flood of malformed
  // attempts is exactly what the throttle exists to stop.
  const result = isValidPin(pin) ? await signInWithPin(eventId, userId, pin) : null;
  notePinAttempt(ip, userId, !!result);
  if (!result) return fail(401, 'wrong PIN');
  return json({ ok: true, token: result.token, staff: result.staff } satisfies LoginResponse);
}
