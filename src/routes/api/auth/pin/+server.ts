import { json, type RequestEvent } from '@sveltejs/kit';
import { isValidPin, type LoginResponse } from '$lib/shared';
import { loginWithPin, notePinAttempt, pinBlocked } from '$lib/server/auth';
import { body, fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';

/**
 * The everyday door for the host: a short PIN, tapped on a keypad.
 *
 * A 6-digit PIN is a 10^6 keyspace, so `pinBlocked` — per-IP *and* global — is what
 * actually protects it. A wrong PIN and an unconfigured one return the same 401, so
 * the endpoint doesn't advertise whether there's a PIN to guess at.
 */
export async function POST(event: RequestEvent) {
  const ip = clientIp(event);
  if (pinBlocked(ip)) return fail(429, 'too many attempts — try again later');

  const b = await body(event);
  const pin = typeof b.pin === 'string' ? b.pin : '';
  // Shape-check before doing any work, but still count it: a flood of malformed
  // attempts is exactly what the throttle exists to stop.
  const result = isValidPin(pin) ? loginWithPin(pin) : null;
  notePinAttempt(ip, !!result);
  if (!result) return fail(401, 'wrong PIN');
  return json({ ok: true, token: result.token, staff: result.staff } satisfies LoginResponse);
}
