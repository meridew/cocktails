import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type LoginResponse } from '$lib/shared';
import { login, loginBlocked, noteLoginAttempt } from '$lib/server/auth';
import { body, fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';

/**
 * Email + password. Kept as the break-glass door beside the PIN, precisely so that
 * jamming the PIN throttle can never lock the bar out entirely.
 */
export async function POST(event: RequestEvent) {
  const ip = clientIp(event);
  if (loginBlocked(ip)) return fail(429, 'too many attempts — try again later');

  const b = await body(event);
  const email = cleanStr(b.email, 120);
  const password = typeof b.password === 'string' ? b.password : '';
  const result = await login(email, password);
  noteLoginAttempt(ip, !!result);
  if (!result) return fail(401, 'wrong email or password');
  return json({ ok: true, token: result.token, staff: result.staff } satisfies LoginResponse);
}
