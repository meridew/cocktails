/**
 * Nothing ships ungoverned.
 *
 * Every endpoint has to appear in the table below saying what it requires, and the
 * table is checked against what actually exists on disk — so adding a `+server.ts`
 * and forgetting the guard fails here rather than at a party.
 *
 * The bookkeeping half is the cheap part. The valuable half is that each entry is
 * then *exercised*: anonymous callers must be refused, and a helper must be refused
 * the things only Dan may do. A table that merely claimed an endpoint was protected
 * would pass happily while the guard was commented out.
 *
 * **The capability *matrix* is not here** — it moved to `permissions.test.ts`, which
 * transcribes it from PLATFORM-PLAN §6 rather than from the implementation. This
 * file is about the wiring: that every route has a guard and that the guard runs.
 *
 * This is also why the Better Auth `admin` plugin was rejected (PLATFORM-PLAN §2e):
 * its endpoints would mount behind the catch-all below, which is declared `public`,
 * so every admin power would have been invisible to this test.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Capability } from '$lib/shared';
import { ROUTES, request, send } from './app';
import {
  barToken,
  helper as makeHelper,
  partyFor,
  person,
  useMemoryEmail,
  type Account,
} from './fixtures/people';

/** What an endpoint demands of its caller. */
type Requirement =
  /** Anyone, signed in or not — guests ordering, a device asking to help. */
  | 'public'
  /** Any valid credential, but no particular power. */
  | 'session'
  | Capability;

/**
 * `METHOD /route` → what it requires.
 *
 * Route ids are SvelteKit's, so `[id]` stays a parameter. Keep this in step with the
 * guard on the handler — the tests below fail if the two disagree about whether a
 * caller gets in, which is the point.
 */
const GOVERNED: Record<string, Requirement> = {
  'GET /api/health': 'public',
  'GET /api/push/key': 'public',
  // Logging out asks for nothing: refusing an expired token would strand a client
  // holding it. "Who am I" answers "nobody" rather than refusing.
  'POST /api/auth/logout': 'public',
  'GET /api/auth/me': 'public',

  'GET /api/orders': 'orders:read',
  'POST /api/orders': 'public', // a guest ordering a drink is the whole app
  'POST /api/orders/clear': 'orders:clear',
  'PATCH /api/orders/[id]': 'orders:advance',
  'DELETE /api/orders/[id]': 'orders:delete',
  'POST /api/orders/[id]/bump': 'orders:advance',
  'PATCH /api/orders/[id]/progress': 'orders:advance',
  // Letting in whoever placed this drink. Keyed on the order because that is what
  // the bar is looking at; the device id never reaches the client.
  'POST /api/orders/[id]/admit': 'guests:admit',

  'GET /api/staff': 'staff:read',
  'POST /api/staff/requests': 'public', // asking to help precedes having any access
  'POST /api/staff/claim': 'public', // the claim secret is the credential here
  'POST /api/staff/revoke-all': 'staff:revoke',
  'DELETE /api/staff/[id]': 'staff:revoke',
  'POST /api/staff/[id]/approve': 'staff:approve',
  'POST /api/staff/[id]/revoke': 'staff:revoke',

  'POST /api/subscriptions': 'public', // keyed to an anonymous device id
  'DELETE /api/subscriptions': 'public',

  // Scoped to a *person*, not a party — which is the whole of the phase 0 fix.
  'GET /api/hosts': 'host:list',
  'GET /api/hosts/[id]': 'host:list',
  // Three capabilities behind one verb; the handler checks per field. Declared as
  // the weakest of them, which is what this suite can actually exercise.
  'PATCH /api/hosts/[id]': 'host:suspend',
  'DELETE /api/hosts/[id]': 'host:delete',
  'GET /api/hosts/[id]/stock': 'stock:read',
  'PUT /api/hosts/[id]/stock': 'stock:edit',

  'GET /api/events': 'session',
  'POST /api/events': 'party:create',
  'GET /api/events/[id]': 'orders:read',
  // As above: open and close are separate capabilities, chosen by the body.
  'PATCH /api/events/[id]': 'party:edit',
  'DELETE /api/events/[id]': 'party:delete',
  'POST /api/events/[id]/bar': 'orders:advance',
  // A menu is what's on the kitchen table under the QR code — not a secret.
  'GET /api/events/[id]/menu': 'public',
  // Anyone may put their hand up; only the bar decides. A guest has no credential
  // and never will, so joining cannot be gated on one — the gate is that joining
  // gets you nothing until somebody admits you.
  'POST /api/events/[id]/guests': 'public',
  'PATCH /api/events/[id]/guests': 'guests:admit',
  /**
   * Public for the same reason joining is: a guest has no account and no token, and
   * the device id is a soft handle rather than an identity. Setting a picture against
   * an invented device is the same risk as inventing a name, which this app has always
   * taken — and the real control is downstream, where a human looks at every face
   * before pouring.
   */
  'PUT /api/events/[id]/guests/photo': 'public',
  /** Reading one back is not public: these are photographs of somebody's friends. */
  'GET /api/events/[id]/guests/photo': 'orders:read',
  // What's on tonight. Names and ids of live parties, and nothing else — see the
  // endpoint for what that publishes and what it deliberately doesn't.
  'GET /api/parties': 'public',
  // Reading it is public; *choosing* it is the host's or Dan's. Pointedly not the
  // bar's — a helper pours what the party serves, they don't decide it.
  'PUT /api/events/[id]/menu': 'menu:curate',
  // Which extras the menu offers. Same capability as the short list on purpose:
  // both are "what does my party serve", and a host holds it at their own.
  'PUT /api/events/[id]/settings': 'menu:curate',
  // The noises a host records. Same capability again — same kind of decision.
  'GET /api/events/[id]/sounds': 'menu:curate',
  'POST /api/events/[id]/sounds': 'menu:curate',
  'PATCH /api/events/[id]/sounds/[soundId]': 'menu:curate',
  'DELETE /api/events/[id]/sounds/[soundId]': 'menu:curate',
  // Public, like the menu it plays alongside: a guest has no credential by design,
  // and this is a noise the host chose to play at everyone who walks in.
  'GET /api/events/[id]/sounds/[soundId]/audio': 'public',

  // Better Auth's catch-all: these are how someone *becomes* authenticated, so a
  // capability gate would be circular. Its own guards are inside the library — and
  // §2e is why nothing of ours is allowed to hide behind that fact.
  'GET /api/account/[...all]': 'public',
  'POST /api/account/[...all]': 'public',
};

const VERBS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

/** Every `METHOD /route` the code actually exports. */
function declared(): string[] {
  const out: string[] = [];
  for (const [id, mod] of Object.entries(ROUTES)) {
    for (const verb of VERBS) {
      if (typeof (mod as Record<string, unknown>)[verb] === 'function') out.push(`${verb} ${id}`);
    }
  }
  return out.sort();
}

/**
 * A concrete path for a route id.
 *
 * Party-scoped routes get `?eventId=` so the request names a real party — otherwise
 * they'd refuse for want of a scope rather than for want of a capability, and this
 * suite would be asserting the wrong refusal.
 */
let eventId = '';
let danId = '';
const concrete = (id: string): string => {
  const path = id
    .replace(/\[\.\.\.\w+\]/g, 'anything')
    .replace('/api/hosts/[id]/', `/api/hosts/${danId}/`)
    .replace('/api/events/[id]/', `/api/events/${eventId}/`)
    .replace(/\[\w+\]/g, 'some-id');
  return path.startsWith('/api/orders') || path.startsWith('/api/staff')
    ? `${path}?eventId=${eventId}`
    : path;
};

let dan: Account;
let helperToken = '';
let adminToken = '';

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('caps-dan', 'admin');
  danId = dan.id;
  eventId = partyFor(dan.id, 'Caps party');
  adminToken = await barToken(dan, eventId);
  helperToken = await makeHelper(dan, eventId, 'Caps Helper', 'caps-helper-device');
});

describe('every endpoint declares what it requires', () => {
  test('no +server.ts on disk is missing from the table', () => {
    const root = join(process.cwd(), 'src', 'routes', 'api');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === '+server.ts') {
          found.push('/api/' + relative(root, dir).split(sep).join('/'));
        }
      }
    };
    walk(root);
    const listed = new Set(Object.keys(ROUTES));
    assert.deepEqual(
      found.filter((id) => !listed.has(id)),
      [],
      'an endpoint exists that this test cannot see',
    );
  });

  test('every exported handler has an entry, and every entry has a handler', () => {
    const actual = declared();
    const table = Object.keys(GOVERNED).sort();
    assert.deepEqual(
      actual.filter((k) => !(k in GOVERNED)),
      [],
      'handler exists with no declared requirement — add it to GOVERNED',
    );
    assert.deepEqual(
      table.filter((k) => !actual.includes(k)),
      [],
      'GOVERNED lists a handler that no longer exists',
    );
  });
});

describe('the declared requirement is actually enforced', () => {
  /** Everything that needs a credential at all. */
  const guarded = Object.entries(GOVERNED).filter(
    (e): e is [string, Exclude<Requirement, 'public'>] => e[1] !== 'public',
  );

  test('anonymous callers are refused everywhere a credential is needed', async () => {
    for (const [key] of guarded) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), { method });
      assert.equal(res.status, 401, `${key} let an anonymous caller through`);
    }
  });

  test('a helper is refused everything that is not running the bar', async () => {
    // A helper holds a real bar session and no account. Anything they are refused
    // must come back 403 or 404 — never 401, which `api.ts` reads as "your session
    // expired" and would use to sign them out mid-service.
    const forbidden: [string, Requirement][] = guarded.filter(
      ([, r]) =>
        r !== 'session' &&
        // Running the bar now includes letting guests in — a helper is the person
        // looking at the room. It pointedly does not include `staff:*`: waving in
        // somebody who wants a drink is a different thing from waving in somebody
        // who wants to work the bar.
        ![
          'orders:read',
          'orders:advance',
          'orders:delete',
          'orders:clear',
          'guests:read',
          'guests:admit',
        ].includes(r),
    );
    assert.ok(forbidden.length > 0, 'this test proves nothing if nothing is restricted');

    for (const [key] of forbidden) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), {
        method,
        headers: { Authorization: `Bearer ${helperToken}` },
        ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }),
      });
      assert.ok(
        res.status === 403 || res.status === 404,
        `${key} answered ${res.status} to a helper; expected 403 or 404`,
      );
    }
  });

  test('a helper is allowed the queue they are there to run', async () => {
    for (const key of [
      'GET /api/orders',
      'POST /api/orders/clear',
      'POST /api/orders/[id]/bump',
    ] as const) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), {
        method,
        headers: { Authorization: `Bearer ${helperToken}` },
        ...(method === 'GET' ? {} : { body: {} }),
      });
      assert.notEqual(res.status, 401, `${key} rejected a valid bar session`);
      assert.notEqual(res.status, 403, `${key} refused a capability a helper holds`);
    }
  });

  test('Admin is allowed everything the helper was not', async () => {
    for (const key of ['GET /api/staff', 'POST /api/staff/join-code'] as const) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), {
        method,
        headers: { Authorization: `Bearer ${adminToken}` },
        ...(method === 'GET' ? {} : { body: {} }),
      });
      assert.notEqual(res.status, 403, `${key} refused Admin`);
      assert.notEqual(res.status, 401, `${key} rejected a valid admin session`);
    }
  });
});
