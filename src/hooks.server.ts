/**
 * Everything Hono's `app.use` chain used to do: request logging, CORS for the
 * native app origins, a body cap, security headers, and a last-resort error
 * handler.
 *
 * Auth is deliberately *not* here. It lives in `$lib/server/guards` and is called
 * on the first line of each protected handler, so the guard sits in the file it
 * protects rather than in a route table several directories away.
 */
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { config } from '$lib/server/config';

/**
 * **Nothing is seeded at boot any more**, and the absence is deliberate.
 *
 * There used to be an `init` hook here that created an admin from the environment
 * and a default event for it to own. Both are gone: Admin is a real account that
 * signs up like anyone else (`ADMIN_EMAILS` only says which account it is), and a
 * party belongs to a host, so there is no such thing as an ownerless one to seed.
 *
 * The consequence worth knowing: **a fresh database has nobody in it.** That is the
 * honest state — the first thing that happens to a new deployment is a person
 * signing up — rather than a fabricated account and a party called "The party" that
 * existed only so the old code had something to point at.
 */

/** Every endpoint takes small JSON; anything larger is a DoS attempt, not a client. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Is the body over the cap?
 *
 * `content-length` is checked first because it's free, but it can't be the only
 * check: a chunked request doesn't send one at all. When it's absent the body is
 * measured for real, on a clone so the handler still gets to read it. Buffering is
 * safe precisely because this is the thing that bounds the size.
 */
async function tooLarge(request: Request): Promise<boolean> {
  if (!request.body) return false;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 0) return declared > MAX_BODY_BYTES;
  try {
    return (await request.clone().text()).length > MAX_BODY_BYTES;
  } catch {
    return false; // unreadable body — the handler's own parsing will reject it
  }
}

const allowedOrigins = new Set(
  Array.isArray(config.allowedOrigin) ? config.allowedOrigin : [config.allowedOrigin],
);

/** '*' means dev, where the app and API are same-origin anyway. */
const originAllowed = (origin: string): boolean =>
  allowedOrigins.has('*') || allowedOrigins.has(origin);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !originAllowed(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const isApi = pathname.startsWith('/api/');
  const origin = event.request.headers.get('origin');

  if (isApi) {
    // Preflight never reaches a handler.
    if (event.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    // A cross-origin caller we don't recognise gets nothing. Same-origin requests
    // send no Origin header at all, so this can't lock out the app itself.
    if (origin && !originAllowed(origin)) {
      return new Response(JSON.stringify({ ok: false, error: 'forbidden origin' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (await tooLarge(event.request)) {
      return new Response(JSON.stringify({ ok: false, error: 'payload too large' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  const started = Date.now();
  const response = await resolve(event);

  if (isApi) {
    for (const [k, v] of Object.entries(corsHeaders(origin))) response.headers.set(k, v);
    // Without this, a failure on the NAS leaves nothing at all in `docker logs`.
    console.log(`${event.request.method} ${pathname} ${response.status} ${Date.now() - started}ms`);
  }

  // Defence in depth on our own responses. Caddy used to add these; it's gone now,
  // so they belong here — this process is the only thing in front of the app.
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-frame-options', 'DENY');
  return response;
};

/**
 * Log the fault, return something generic. A stack trace must never reach a client,
 * and an unhandled throw must never take the process down mid-party.
 */
export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`unhandled error on ${event.request.method} ${event.url.pathname}:`, error);
  return { message: 'internal error' };
};
