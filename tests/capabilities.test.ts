/**
 * Nothing ships ungoverned.
 *
 * Every endpoint has to appear in the table below saying what it requires, and the
 * table is checked against what actually exists on disk — so adding a `+server.ts`
 * and forgetting the guard fails here rather than at a party.
 *
 * The bookkeeping half is the cheap part. The valuable half is that each entry is
 * then *exercised*: anonymous callers must be refused, and a bartender must be
 * refused the things only a host may do. A table that merely claims an endpoint is
 * protected would pass happily while the guard was commented out.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CAPABILITIES, can, type Capability } from '$lib/shared';
import { ROUTES, request, send } from './app';
import { hashPassword, ensureLiveEvent } from '$lib/server/auth';
import { createStaff, genId } from '$lib/server/db';

/** What an endpoint demands of its caller. */
type Requirement =
  /** Anyone, signed in or not — guests ordering, a device asking to help. */
  | 'public'
  /** Any active staff member, but no particular power: the identity endpoints. */
  | 'session'
  /** A signed-in host account rather than a bar session. */
  | 'account'
  | Capability;

/**
 * `METHOD /route` → what it requires.
 *
 * Route ids are SvelteKit's, so `[id]` stays a parameter. Keep this in step with
 * the guard on the handler — the tests below fail if the two disagree about
 * whether a caller gets in, which is the point.
 */
const GOVERNED: Record<string, Requirement> = {
  'GET /api/health': 'public',
  'GET /api/push/key': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/pin': 'public',
  'POST /api/auth/logout': 'session',
  'GET /api/auth/me': 'session',

  'GET /api/orders': 'orders:read',
  'POST /api/orders': 'public', // a guest ordering a drink is the whole app
  'POST /api/orders/clear': 'orders:clear',
  'PATCH /api/orders/[id]': 'orders:advance',
  'DELETE /api/orders/[id]': 'orders:delete',
  'POST /api/orders/[id]/bump': 'orders:advance',
  'PATCH /api/orders/[id]/progress': 'orders:advance',

  'GET /api/staff': 'staff:read',
  'POST /api/staff/requests': 'public', // asking to help precedes having any access
  'POST /api/staff/claim': 'public', // the claim secret is the credential here
  'POST /api/staff/join': 'public', // as is the join code
  'POST /api/staff/join-code': 'staff:invite',
  'DELETE /api/staff/join-code': 'staff:invite',
  'POST /api/staff/revoke-all': 'staff:revoke',
  'DELETE /api/staff/[id]': 'staff:revoke',
  'POST /api/staff/[id]/approve': 'staff:approve',
  'POST /api/staff/[id]/revoke': 'staff:revoke',

  'POST /api/subscriptions': 'public', // keyed to an anonymous device id
  'DELETE /api/subscriptions': 'public',

  // Owned by a host *account*, not a bar session — `requireAccount`, not a
  // capability. The staff capability table has nothing to say about someone who
  // isn't behind a bar yet.
  'GET /api/inventory': 'inventory:read',
  'PUT /api/inventory': 'inventory:edit',

  'GET /api/events': 'account',
  'POST /api/events': 'account',
  'POST /api/events/[id]/bar': 'account',
  // A menu is what's on the kitchen table under the QR code — not a secret.
  'GET /api/events/[id]/menu': 'public',

  // Better Auth's catch-all: these are how someone *becomes* authenticated, so a
  // capability gate would be circular. Its own guards are inside the library.
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

/** A concrete path for a route id, so parameterised routes can be called. */
const concrete = (id: string): string =>
  id.replace(/\[\.\.\.\w+\]/g, 'anything').replace(/\[\w+\]/g, 'some-id');

const ADMIN = { email: 'caps-admin@local', password: 'caps-admin-pw' };
let adminToken = '';
let bartenderToken = '';

beforeAll(async () => {
  createStaff({
    eventId: ensureLiveEvent(),
    id: genId(),
    displayName: 'Caps Admin',
    email: ADMIN.email,
    passwordHash: await hashPassword(ADMIN.password),
    role: 'admin',
    status: 'active',
  });
  const login = await request('/api/auth/login', send('POST', ADMIN));
  assert.equal(login.status, 200, 'fixture admin login should succeed');
  adminToken = ((await login.json()) as { token: string }).token;

  // A real bartender, minted the way a real one is: the host reads out a code and
  // the helper redeems it. Fabricating a session row directly would test the table
  // rather than the system.
  const minted = await request('/api/staff/join-code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(minted.status, 200, 'admin should be able to mint a join code');
  const { code } = (await minted.json()) as { code: string };

  const joined = await request(
    '/api/staff/join',
    send('POST', { code, deviceId: 'caps-helper-device', name: 'Caps Helper' }),
  );
  assert.equal(joined.status, 200, 'the code should let a helper in');
  bartenderToken = ((await joined.json()) as { token: string }).token;
  assert.ok(bartenderToken);
});

describe('the capability table', () => {
  const admin = { role: 'admin', status: 'active' } as const;
  const helper = { role: 'bartender', status: 'active' } as const;

  test('an admin holds everything', () => {
    for (const cap of CAPABILITIES) assert.equal(can(admin, cap), true, `admin lacks ${cap}`);
  });

  test('a bartender runs the service but does not decide who else does', () => {
    // This is the rule `canApproveStaff` used to encode on its own, now stated once
    // where the server guard reads it too.
    for (const cap of ['orders:read', 'orders:advance', 'orders:delete', 'orders:clear'] as const) {
      assert.equal(can(helper, cap), true, `a bartender should hold ${cap}`);
    }
    for (const cap of ['staff:approve', 'staff:revoke', 'staff:invite', 'staff:read'] as const) {
      assert.equal(can(helper, cap), false, `a bartender must not hold ${cap}`);
    }
  });

  test('the host owns the stock list; a helper only reads it', () => {
    assert.equal(can(admin, 'inventory:edit'), true);
    assert.equal(can(helper, 'inventory:read'), true);
    assert.equal(can(helper, 'inventory:edit'), false);
  });

  test('status beats role, so a revoked admin holds nothing', () => {
    // The session token outlives the revocation by design — it's the capability
    // check that has to stop them, not the absence of a credential.
    for (const status of ['pending', 'revoked'] as const) {
      for (const cap of CAPABILITIES) {
        assert.equal(can({ role: 'admin', status }, cap), false, `${status} admin held ${cap}`);
      }
    }
  });

  test('nobody is nobody', () => {
    for (const cap of CAPABILITIES) {
      assert.equal(can(null, cap), false);
      assert.equal(can(undefined, cap), false);
    }
  });
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
  /** Everything that needs a session at all. */
  const guarded = Object.entries(GOVERNED).filter(
    (e): e is [string, Exclude<Requirement, 'public'>] => e[1] !== 'public',
  );
  /**
   * Of those, the ones gated on a named power rather than mere identity.
   * `account` endpoints are excluded: they answer to a host's account session, not
   * to a bar session, so the staff capability table has nothing to say about them.
   */
  const capabilityGated = guarded.filter(
    (e): e is [string, Capability] => e[1] !== 'session' && e[1] !== 'account',
  );

  test('anonymous callers are refused everywhere a session is needed', async () => {
    for (const [key] of guarded) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), { method });
      assert.equal(res.status, 401, `${key} let an anonymous caller through`);
    }
  });

  test('a bartender is refused the capabilities they do not hold', async () => {
    const helper = { role: 'bartender', status: 'active' } as const;
    const forbidden = capabilityGated.filter(([, cap]) => !can(helper, cap));
    assert.ok(forbidden.length > 0, 'this test proves nothing if nothing is admin-only');

    for (const [key] of forbidden) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), {
        method,
        headers: { Authorization: `Bearer ${bartenderToken}` },
      });
      assert.equal(res.status, 403, `${key} should be refused to a bartender`);
    }
  });

  test('a bartender is allowed the capabilities they do hold', async () => {
    const helper = { role: 'bartender', status: 'active' } as const;
    const allowed = capabilityGated.filter(([, cap]) => can(helper, cap));
    assert.ok(allowed.length > 0, 'this test proves nothing if a bartender can do nothing');

    for (const [key] of allowed) {
      const [method, id] = key.split(' ') as [string, string];
      const res = await request(concrete(id), {
        method,
        headers: { Authorization: `Bearer ${bartenderToken}` },
        // A body only where the verb permits one — fetch refuses to build a GET
        // with one. The content is irrelevant: these assert on the guard, and a
        // 404 or 422 past it is a pass.
        ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }),
      });
      assert.notEqual(res.status, 401, `${key} rejected a valid bartender session`);
      assert.notEqual(res.status, 403, `${key} refused a capability a bartender holds`);
    }
  });
});
