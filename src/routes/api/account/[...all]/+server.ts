import type { RequestEvent } from '@sveltejs/kit';
import { accounts } from '$lib/server/accounts';

/**
 * Better Auth owns every path under `/api/account` — sign-up, verification,
 * sign-in, reset, and the OAuth callbacks when those are configured.
 *
 * It takes the raw `Request` and returns a `Response`, so there is nothing to
 * translate. The guard is inside: these are the endpoints an unauthenticated
 * person uses to *become* authenticated, which is why they are declared public in
 * `tests/capabilities.test.ts` rather than gated on a capability.
 */
const handler = ({ request }: RequestEvent): Promise<Response> => accounts().handler(request);

export const GET = handler;
export const POST = handler;
