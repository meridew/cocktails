/**
 * A test-only dispatcher: `request('/api/orders/abc/bump', { method: 'POST' })`
 * finds the matching `+server.ts` and calls its exported handler.
 *
 * Why this exists: the endpoints are plain exported functions, so tests *can* just
 * import and call them — but roughly 500 existing assertions are written in terms
 * of paths and methods, and rewriting every one to import a specific module would
 * be a lot of churn for no extra confidence. This keeps them as they are.
 *
 * It is emphatically not a router. It resolves against an explicit table, and
 * `routes.test.ts` asserts that every `+server.ts` on disk appears in it — so a
 * new endpoint that this file doesn't know about fails a test rather than silently
 * going untested.
 */
import { makeEvent } from './event';
import { handle } from '../src/hooks.server';

import * as health from '../src/routes/api/health/+server';
import * as pushKey from '../src/routes/api/push/key/+server';
import * as authLogin from '../src/routes/api/auth/login/+server';
import * as authPin from '../src/routes/api/auth/pin/+server';
import * as authLogout from '../src/routes/api/auth/logout/+server';
import * as authMe from '../src/routes/api/auth/me/+server';
import * as orders from '../src/routes/api/orders/+server';
import * as ordersClear from '../src/routes/api/orders/clear/+server';
import * as orderById from '../src/routes/api/orders/[id]/+server';
import * as orderBump from '../src/routes/api/orders/[id]/bump/+server';
import * as orderProgress from '../src/routes/api/orders/[id]/progress/+server';
import * as staff from '../src/routes/api/staff/+server';
import * as staffRequests from '../src/routes/api/staff/requests/+server';
import * as staffClaim from '../src/routes/api/staff/claim/+server';
import * as staffJoin from '../src/routes/api/staff/join/+server';
import * as staffJoinCode from '../src/routes/api/staff/join-code/+server';
import * as staffRevokeAll from '../src/routes/api/staff/revoke-all/+server';
import * as staffById from '../src/routes/api/staff/[id]/+server';
import * as staffApprove from '../src/routes/api/staff/[id]/approve/+server';
import * as staffRevoke from '../src/routes/api/staff/[id]/revoke/+server';
import * as subscriptions from '../src/routes/api/subscriptions/+server';
import * as account from '../src/routes/api/account/[...all]/+server';
import * as events from '../src/routes/api/events/+server';
import * as inventory from '../src/routes/api/inventory/+server';
import * as eventMenu from '../src/routes/api/events/[id]/menu/+server';
import * as eventBar from '../src/routes/api/events/[id]/bar/+server';

type Handlers = Record<string, unknown>;

/** Route id (as SvelteKit names it) → the module. Order is irrelevant; matching is exact. */
export const ROUTES: Record<string, Handlers> = {
  '/api/health': health,
  '/api/push/key': pushKey,
  '/api/auth/login': authLogin,
  '/api/auth/pin': authPin,
  '/api/auth/logout': authLogout,
  '/api/auth/me': authMe,
  '/api/orders': orders,
  '/api/orders/clear': ordersClear,
  '/api/orders/[id]': orderById,
  '/api/orders/[id]/bump': orderBump,
  '/api/orders/[id]/progress': orderProgress,
  '/api/staff': staff,
  '/api/staff/requests': staffRequests,
  '/api/staff/claim': staffClaim,
  '/api/staff/join': staffJoin,
  '/api/staff/join-code': staffJoinCode,
  '/api/staff/revoke-all': staffRevokeAll,
  '/api/staff/[id]': staffById,
  '/api/staff/[id]/approve': staffApprove,
  '/api/staff/[id]/revoke': staffRevoke,
  '/api/subscriptions': subscriptions,
  '/api/events': events,
  '/api/inventory': inventory,
  '/api/events/[id]/bar': eventBar,
  '/api/events/[id]/menu': eventMenu,
  // Better Auth's catch-all. Listed last for readability; matching order is the
  // pass order in resolve(), not this one.
  '/api/account/[...all]': account,
};

const isRest = (s: string): boolean => s.startsWith('[...');
const isParam = (s: string): boolean => s.startsWith('[');

/**
 * Match a concrete path to a route id, pulling out any params.
 *
 * Three passes, least greedy first. Exact beats parameterised, so
 * `/api/staff/claim` never resolves to `/api/staff/[id]` merely because it has the
 * right number of segments; and both beat a rest route, so Better Auth's
 * `/api/account/[...all]` catch-all only sees what nothing else claimed.
 */
function resolve(path: string): { id: string; params: Record<string, string> } | null {
  const parts = path.split('?')[0]!.split('/').filter(Boolean);

  for (const pass of ['exact', 'param', 'rest'] as const) {
    for (const id of Object.keys(ROUTES)) {
      const seg = id.split('/').filter(Boolean);
      const hasRest = seg.some(isRest);
      if (hasRest !== (pass === 'rest')) continue;

      if (pass === 'rest') {
        // Everything before the [...rest] must match; the rest swallows the tail,
        // which may be empty.
        const head = seg.slice(0, seg.findIndex(isRest));
        if (parts.length < head.length) continue;
        if (!head.every((s, i) => s === parts[i])) continue;
        const name = seg[head.length]!.slice(4, -1);
        return { id, params: { [name]: parts.slice(head.length).join('/') } };
      }

      if (seg.length !== parts.length) continue;
      const parameterised = seg.some(isParam);
      if ((pass === 'exact') === parameterised) continue;
      const params: Record<string, string> = {};
      const ok = seg.every((s, i) => {
        if (isParam(s)) {
          params[s.slice(1, -1)] = parts[i]!;
          return true;
        }
        return s === parts[i];
      });
      if (ok) return { id, params };
    }
  }
  return null;
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  ip?: string;
}

/**
 * Call the handler for `path`, the way the framework would — *through*
 * `hooks.server.ts`.
 *
 * Running the hook matters: the body cap, CORS and the security headers all live
 * there, and calling handlers directly quietly skipped them. The oversized-body
 * test caught that immediately, which is the argument for keeping this faithful
 * rather than convenient.
 */
export async function request(path: string, init: RequestInitLike = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const match = resolve(path);
  if (!match) throw new Error(`no route for ${path} — add it to tests/app.ts`);

  const event = makeEvent({
    method,
    headers: init.headers,
    body: init.body,
    params: match.params,
    ip: init.ip,
    path,
  });

  const dispatch = async (): Promise<Response> => {
    const handler = ROUTES[match.id]![method];
    if (typeof handler !== 'function') {
      // SvelteKit answers an unsupported verb with 405; mirroring that keeps tests
      // honest about which methods a route actually exposes.
      return new Response(null, { status: 405 });
    }
    return (await (handler as (e: unknown) => Response | Promise<Response>)(event)) as Response;
  };

  return handle({ event, resolve: dispatch } as never);
}

/** Shorthand matching the old suites: `send('POST', body, headers)`. */
export const send = (
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInitLike => ({ method, body, headers });
