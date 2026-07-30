/**
 * Build a `RequestEvent` so route handlers can be called directly.
 *
 * The old suite drove Hono via `app.request()`, which SvelteKit has no equivalent
 * of. The alternative considered was extracting each handler into `$lib/server` with
 * `+server.ts` as a one-line wrapper — but that's two files per endpoint purely to
 * suit the tests. `+server.ts` exports plain functions, so they can just be imported
 * and called; this constructs the argument.
 *
 * Same in-process character as before: no port, no network, no server.
 */
import type { RequestEvent } from '@sveltejs/kit';

export interface EventInit {
  method?: string;
  /** Serialised as JSON unless it's already a string (for malformed-body cases). */
  body?: unknown;
  headers?: Record<string, string>;
  /** Route params, e.g. `{ id: 'abc' }` for /api/orders/[id]. */
  params?: Record<string, string>;
  /** Bearer token, as a shorthand for the Authorization header. */
  token?: string;
  /** What `getClientAddress()` reports — the socket address, not a header. */
  ip?: string;
  path?: string;
}

export function makeEvent(init: EventInit = {}): RequestEvent {
  const { method = 'GET', body, headers = {}, params = {}, token, ip = '127.0.0.1' } = init;
  const path = init.path ?? '/api/test';

  const allHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) allHeaders['content-type'] ??= 'application/json';
  if (token) allHeaders['authorization'] = `Bearer ${token}`;

  const url = new URL(`http://localhost${path}`);
  const request = new Request(url, {
    method,
    headers: allHeaders,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  // Only the surface the handlers actually touch is populated; anything else would
  // be a fiction that could drift from the real shape without anything noticing.
  return {
    request,
    url,
    params,
    getClientAddress: () => ip,
    locals: {},
    cookies: undefined,
    fetch,
    platform: undefined,
    route: { id: null },
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

/** Read a handler's JSON response, with its status. */
export async function read<T = Record<string, unknown>>(
  res: Response | Promise<Response>,
): Promise<{ status: number; body: T }> {
  const r = await res;
  const text = await r.text();
  return {
    status: r.status,
    body: (text ? JSON.parse(text) : {}) as T,
  };
}

/** Distinct IPs, so one test's rate-limit spend can't fail the next one. */
let ipCounter = 0;
export const freshIp = (): string => `203.0.113.${++ipCounter % 250}`;
