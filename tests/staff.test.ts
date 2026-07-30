/**
 * The request-to-help → admin-approval flow, end to end over HTTP.
 *
 * The security properties that matter here:
 *   • a helper's deviceId is NOT a credential — knowing it must not let anyone
 *     collect someone else's approval (that's what the claim secret is for)
 *   • only admins decide; a signed-in bartender can't approve or promote
 *   • revoking is immediate, even with an unexpired token
 *   • the env-seeded admin can never be revoked or removed (no lock-out)
 */
import { test, describe, beforeAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import type { Staff, StaffClaimResponse } from '$lib/shared';
import { request } from './app';
import { hashPassword } from '$lib/server/auth';
import { createStaff, genId, listStaff, deleteStaff } from '$lib/server/db';

const ADMIN = { email: 'admin@local', password: 'admin-pw' };
let adminToken = '';

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Ask to help, returning the one-time claim secret. */
async function askToHelp(name: string, deviceId: string): Promise<string> {
  const res = await request('/api/staff/requests', post({ name, deviceId }));
  assert.equal(res.status, 200, 'a request should be accepted');
  return ((await res.json()) as { claim: string }).claim;
}

const claim = async (secret: string): Promise<StaffClaimResponse> => {
  const res = await request('/api/staff/claim', post({ claim: secret }));
  assert.equal(res.status, 200);
  return (await res.json()) as StaffClaimResponse;
};

const pendingFor = (name: string): Staff | undefined =>
  listStaff()
    .map((r) => ({ id: r.id, name: r.display_name, status: r.status }) as unknown as Staff)
    .find((s) => s.name === name && s.status === 'pending');

beforeAll(async () => {
  createStaff({
    id: genId(),
    displayName: 'Admin',
    email: ADMIN.email,
    passwordHash: await hashPassword(ADMIN.password),
    role: 'admin',
    status: 'active',
  });
  const res = await request('/api/auth/login', post(ADMIN));
  adminToken = ((await res.json()) as { token: string }).token;
  assert.ok(adminToken);
});

// Keep each test's view of the staff list to itself.
beforeEach(() => {
  for (const row of listStaff()) if (row.role !== 'admin') deleteStaff(row.id);
});

describe('asking to help', () => {
  test('requires a name and a device', async () => {
    for (const body of [
      {},
      { name: 'Sarah' },
      { deviceId: 'dev-1' },
      { name: '   ', deviceId: 'd' },
    ]) {
      const res = await request('/api/staff/requests', post(body));
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });

  test('creates a pending member the admin can see, and grants nothing yet', async () => {
    const secret = await askToHelp('Sarah', 'dev-sarah');
    assert.match(secret, /^[0-9a-f]{64}$/, 'the claim should be a long random secret');

    const listed = await request('/api/staff', { headers: auth(adminToken) });
    const { staff } = (await listed.json()) as { staff: Staff[] };
    const sarah = staff.find((s) => s.name === 'Sarah');
    assert.ok(sarah, 'the request should appear in the admin list');
    assert.equal(sarah.status, 'pending');
    assert.equal(sarah.role, 'bartender');
    assert.equal(sarah.email, null, 'a helper has no sign-in email');

    assert.deepEqual(await claim(secret), { ok: true, status: 'pending' });
  });

  test('asking twice from one device reuses the request instead of queueing duplicates', async () => {
    const first = await askToHelp('Sarah', 'dev-sarah');
    const second = await askToHelp('Sarah', 'dev-sarah');
    assert.notEqual(first, second, 'a fresh secret is issued');

    const pending = listStaff().filter((r) => r.status === 'pending');
    assert.equal(pending.length, 1, 'still exactly one pending request');

    // The newest secret works; the superseded one no longer does.
    assert.equal((await claim(second)).status, 'pending');
    assert.equal((await claim(first)).status, 'denied', 'the old secret should stop working');
  });
});

describe('approval', () => {
  test('an approved helper exchanges the claim for a session, exactly once', async () => {
    const secret = await askToHelp('Sarah', 'dev-sarah');
    const sarah = pendingFor('Sarah');
    assert.ok(sarah);

    const approved = await request(`/api/staff/${sarah.id}/approve`, post({}, auth(adminToken)));
    assert.equal(approved.status, 200);

    const collected = await claim(secret);
    assert.equal(collected.status, 'active');
    assert.ok(collected.status === 'active' && collected.token, 'a session token is issued');
    assert.equal(collected.status === 'active' && collected.staff.role, 'bartender');

    // The claim is consumed, so a leaked secret can't mint a second session.
    assert.equal((await claim(secret)).status, 'denied', 'the claim must be single-use');
  });

  test('the session works on staff routes but not on admin ones', async () => {
    const secret = await askToHelp('Sarah', 'dev-sarah');
    const sarah = pendingFor('Sarah');
    assert.ok(sarah);
    await request(`/api/staff/${sarah.id}/approve`, post({}, auth(adminToken)));
    const collected = await claim(secret);
    assert.equal(collected.status, 'active');
    const helperToken = collected.status === 'active' ? collected.token : '';

    const queue = await request('/api/orders', { headers: auth(helperToken) });
    assert.equal(queue.status, 200, 'a helper can run the bar');

    // 403 not 401: authenticated, but not permitted — and can't self-promote.
    const list = await request('/api/staff', { headers: auth(helperToken) });
    assert.equal(list.status, 403, 'a helper must not see or manage staff');

    const selfApprove = await request(
      `/api/staff/${sarah.id}/approve`,
      post({}, auth(helperToken)),
    );
    assert.equal(selfApprove.status, 403);
  });

  test('approving something that is not pending fails', async () => {
    const res = await request('/api/staff/nope/approve', post({}, auth(adminToken)));
    assert.equal(res.status, 404);
  });

  test('only an admin can approve — anonymous callers get 401', async () => {
    const secret = await askToHelp('Sarah', 'dev-sarah');
    const sarah = pendingFor('Sarah');
    assert.ok(sarah);
    const res = await request(`/api/staff/${sarah.id}/approve`, post({}));
    assert.equal(res.status, 401);
    assert.equal((await claim(secret)).status, 'pending', 'still not approved');
  });

  test('denying removes the request, and its claim stops working', async () => {
    const secret = await askToHelp('Mallory', 'dev-mallory');
    const mallory = pendingFor('Mallory');
    assert.ok(mallory);

    const denied = await request(`/api/staff/${mallory.id}`, {
      method: 'DELETE',
      headers: auth(adminToken),
    });
    assert.equal(denied.status, 200);
    assert.equal((await claim(secret)).status, 'denied');
    assert.equal(pendingFor('Mallory'), undefined);
  });
});

describe('claim secrets', () => {
  test('a wrong or empty claim is denied, not distinguishable from a real one', async () => {
    for (const secret of ['', 'garbage', 'a'.repeat(64)]) {
      assert.equal((await claim(secret)).status, 'denied', JSON.stringify(secret));
    }
  });

  test('knowing a deviceId is not enough to collect an approval', async () => {
    // The deviceId travels in every order payload, so it is not secret. Only the
    // claim secret held by the requesting device may collect the session.
    const secret = await askToHelp('Sarah', 'dev-sarah');
    const sarah = pendingFor('Sarah');
    assert.ok(sarah);
    await request(`/api/staff/${sarah.id}/approve`, post({}, auth(adminToken)));

    // An attacker who knows the deviceId still has no way in…
    assert.equal((await claim('dev-sarah')).status, 'denied');
    // …while the real device collects fine.
    assert.equal((await claim(secret)).status, 'active');
  });
});

describe('revocation', () => {
  /** Approve a helper and return their session token. */
  async function approvedHelper(name: string, deviceId: string) {
    const secret = await askToHelp(name, deviceId);
    const row = pendingFor(name);
    assert.ok(row);
    await request(`/api/staff/${row.id}/approve`, post({}, auth(adminToken)));
    const collected = await claim(secret);
    assert.equal(collected.status, 'active');
    return { id: row.id, token: collected.status === 'active' ? collected.token : '' };
  }

  test('revoking takes effect immediately, despite an unexpired token', async () => {
    const helper = await approvedHelper('Sarah', 'dev-sarah');
    assert.equal((await request('/api/orders', { headers: auth(helper.token) })).status, 200);

    const revoked = await request(`/api/staff/${helper.id}/revoke`, post({}, auth(adminToken)));
    assert.equal(revoked.status, 200);

    const after = await request('/api/orders', { headers: auth(helper.token) });
    assert.equal(after.status, 401, 'the existing session must stop working at once');
  });

  test('revoke-all clears every helper but leaves the admin signed in', async () => {
    const a = await approvedHelper('Sarah', 'dev-sarah');
    const b = await approvedHelper('Tom', 'dev-tom');

    const res = await request('/api/staff/revoke-all', post({}, auth(adminToken)));
    assert.equal(res.status, 200);

    for (const helper of [a, b]) {
      assert.equal((await request('/api/orders', { headers: auth(helper.token) })).status, 401);
    }
    const stillAdmin = await request('/api/auth/me', { headers: auth(adminToken) });
    assert.equal(stillAdmin.status, 200, 'the admin must not lock themselves out');
  });

  test('an admin cannot be revoked or removed (no lock-out)', async () => {
    const me = await request('/api/auth/me', { headers: auth(adminToken) });
    const { staff } = (await me.json()) as { staff: Staff };

    const revoke = await request(`/api/staff/${staff.id}/revoke`, post({}, auth(adminToken)));
    assert.equal(revoke.status, 403);

    const remove = await request(`/api/staff/${staff.id}`, {
      method: 'DELETE',
      headers: auth(adminToken),
    });
    assert.equal(remove.status, 403);

    const after = await request('/api/auth/me', { headers: auth(adminToken) });
    assert.equal(after.status, 200, 'the admin should still be signed in');
  });

  test('a revoked helper cannot sign in, and asking again starts a fresh request', async () => {
    const helper = await approvedHelper('Sarah', 'dev-sarah');
    await request(`/api/staff/${helper.id}/revoke`, post({}, auth(adminToken)));

    // Asking again is allowed — it's a new pending request needing approval.
    const secret = await askToHelp('Sarah', 'dev-sarah');
    assert.equal((await claim(secret)).status, 'pending');
  });
});
