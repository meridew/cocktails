import type { RequestEvent } from '@sveltejs/kit';
import { accounts } from '$lib/server/accounts';
import { fail } from '$lib/server/guards';
import { clientIp } from '$lib/server/http';
import { createRateLimiter } from '$lib/server/ratelimit';

/**
 * Better Auth owns every path under `/api/account` — sign-up, verification,
 * sign-in, reset, and the OAuth callbacks when those are configured.
 *
 * It takes the raw `Request` and returns a `Response`, so there is nothing to
 * translate. The guard is inside: these are the endpoints an unauthenticated person
 * uses to *become* authenticated, which is why they are declared public in
 * `tests/capabilities.test.ts` rather than gated on a capability.
 */

/**
 * Sign-up is throttled per IP, because this door faces the internet.
 *
 * Registration is deliberately open — a friend should be able to join without Dan
 * doing admin — and the machine answering is in his house. Without a brake, one
 * script fills the `user` table and sends a verification email per row through a
 * shared M365 mailbox, which is the sort of thing that costs a sending reputation
 * rather than just some disk.
 *
 * Generous on purpose: registrations are rare and legitimate ones cluster — a
 * household behind one NAT, or Dan signing up three friends at a table. The number
 * is well above anything that happens honestly and well below what makes bulk
 * registration worth anyone's time.
 *
 * Sign-in is **not** throttled here. Better Auth handles credential attempts, and a
 * shared brake would let someone lock the front door for everybody by hammering
 * sign-up instead.
 */
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const signUps = createRateLimiter({ max: 30, windowMs: SIGNUP_WINDOW_MS });

const isSignUp = (event: RequestEvent): boolean =>
  event.url.pathname.includes('/sign-up') || event.url.pathname.includes('/send-verification');

async function handler(event: RequestEvent): Promise<Response> {
  if (event.request.method === 'POST' && isSignUp(event)) {
    const ip = clientIp(event);
    if (signUps.isLimited(ip)) return fail(429, 'too many sign-ups — try again later');
    signUps.record(ip);
  }
  return accounts().handler(event.request);
}

export const GET = handler;
export const POST = handler;
