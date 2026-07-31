/**
 * The admin surface: managing hosts, and a party's lifecycle.
 *
 * These are the four powers Dan asked for — see every host, edit anyone's cupboard,
 * create and end their parties, suspend or remove an account, promote another admin
 * — built as our own endpoints rather than taken from Better Auth's `admin` plugin.
 * PLATFORM-PLAN §2e records why: the plugin's routes mount behind a catch-all that
 * `capabilities.test.ts` declares public, so every one of them would have shipped
 * outside the only test whose job is that nothing does.
 *
 * The interesting assertions here are the refusals. A power that works is easy; a
 * power that cannot be turned on yourself, or used to lock yourself out, is the part
 * worth pinning down.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { userById } from '$lib/server/db';
import { asAccount, partyFor, person, useMemoryEmail, type Account } from './fixtures/people';

let dan: Account;
let ana: Account;
let bruno: Account;

interface HostRow {
  id: string;
  email: string;
  role: string;
  bannedAt: number | null;
  banReason: string | null;
  hasStock: boolean;
  parties: number;
  adminByConfig: boolean;
}

const hosts = async (who: Account) => {
  const res = await request('/api/hosts', { headers: asAccount(who) });
  assert.equal(res.status, 200);
  return ((await res.json()) as { hosts: HostRow[] }).hosts;
};

const patchHost = (who: Account, id: string, b: unknown) =>
  request(`/api/hosts/${id}`, send('PATCH', b, asAccount(who)));

const patchParty = (who: Account, id: string, b: unknown) =>
  request(`/api/events/${id}`, send('PATCH', b, asAccount(who)));

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('admin-dan', 'admin');
  ana = await person('admin-ana');
  bruno = await person('admin-bruno');
});

describe('seeing the hosts', () => {
  test('Admin sees everyone, with enough to render a list', async () => {
    const list = await hosts(dan);
    const found = list.find((h) => h.id === ana.id);
    assert.ok(found, 'ana should appear');
    assert.equal(found.role, 'host');
    assert.equal(found.bannedAt, null);
    assert.equal(found.hasStock, false, 'she has not opened her cupboard');
    assert.equal(typeof found.parties, 'number');
  });

  test('a host sees nobody, including themselves', async () => {
    assert.equal((await request('/api/hosts', { headers: asAccount(ana) })).status, 403);
    assert.equal(
      (await request(`/api/hosts/${bruno.id}`, { headers: asAccount(ana) })).status,
      403,
    );
  });

  test('a stranger sees nothing', async () => {
    assert.equal((await request('/api/hosts')).status, 401);
  });
});

describe('suspending an account', () => {
  test('a ban takes effect on the next request, not the next sign-in', async () => {
    // The session outlives the ban by design; it is the actor resolution that has to
    // stop them, which is why `usable()` sits in the guard rather than at sign-in.
    const victim = await person('admin-victim');
    const party = partyFor(victim.id, "Victim's party");
    assert.equal((await request('/api/events', { headers: asAccount(victim) })).status, 200);

    const res = await patchHost(dan, victim.id, { banned: true, reason: 'testing' });
    assert.equal(res.status, 200);

    const after = await request('/api/events', { headers: asAccount(victim) });
    assert.equal(after.status, 401, 'a suspended account is nobody, immediately');
    // And their party is still there — a ban is not a deletion.
    assert.equal((await request(`/api/events/${party}/menu`)).status, 200);
  });

  test('lifting it clears the reason with it', async () => {
    const victim = await person('admin-lifted');
    await patchHost(dan, victim.id, { banned: true, reason: 'a reason' });
    const banned = (await hosts(dan)).find((h) => h.id === victim.id);
    assert.equal(banned?.banReason, 'a reason');

    await patchHost(dan, victim.id, { banned: false });
    const lifted = (await hosts(dan)).find((h) => h.id === victim.id);
    assert.equal(lifted?.bannedAt, null);
    assert.equal(lifted?.banReason, null, 'a lifted ban that kept its reason reads as still on');
  });

  test('you cannot suspend yourself', async () => {
    // The one case that locks the operator out of their own service with no way back
    // in short of editing the database by hand.
    const res = await patchHost(dan, dan.id, { banned: true });
    assert.equal(res.status, 422);
    assert.equal(userById(dan.id)?.bannedAt, null);
  });

  test('and a host cannot suspend anybody', async () => {
    assert.equal((await patchHost(ana, bruno.id, { banned: true })).status, 403);
    assert.equal(userById(bruno.id)?.bannedAt, null);
  });
});

describe('granting admin', () => {
  test('Admin can promote and demote', async () => {
    const promoted = await person('admin-promoted');
    assert.equal((await patchHost(dan, promoted.id, { role: 'admin' })).status, 200);
    assert.equal(userById(promoted.id)?.role, 'admin');

    // And the promotion is real: they can now see the host list.
    assert.equal((await request('/api/hosts', { headers: asAccount(promoted) })).status, 200);

    assert.equal((await patchHost(dan, promoted.id, { role: 'host' })).status, 200);
    assert.equal(userById(promoted.id)?.role, 'host');
  });

  test('a host cannot promote themselves', async () => {
    assert.equal((await patchHost(ana, ana.id, { role: 'admin' })).status, 403);
    assert.equal(userById(ana.id)?.role, 'host');
  });

  test('a nonsense role is refused rather than stored', async () => {
    assert.equal((await patchHost(dan, ana.id, { role: 'wizard' })).status, 422);
    assert.equal(userById(ana.id)?.role, 'host');
  });

  test('an empty PATCH still needs permission', async () => {
    // The hole `capabilities.test.ts` caught the first time this endpoint was
    // written: with the checks only inside the per-field branches, a body matching
    // neither reached the end having asked nobody.
    assert.equal((await request(`/api/hosts/${ana.id}`, send('PATCH', {}))).status, 401);
    assert.equal((await patchHost(ana, bruno.id, {})).status, 403);
  });
});

describe('removing an account', () => {
  test('it takes their parties with it', async () => {
    const doomed = await person('admin-doomed');
    const party = partyFor(doomed.id, 'A party that should not outlive its host');
    assert.equal((await request(`/api/events/${party}/menu`)).status, 200);

    assert.equal(
      (await request(`/api/hosts/${doomed.id}`, { method: 'DELETE', headers: asAccount(dan) }))
        .status,
      200,
    );
    assert.equal(userById(doomed.id), null);
    assert.equal(
      (await request(`/api/events/${party}/menu`)).status,
      404,
      'a deleted host must not leave their evening in somebody else’s database',
    );
  });

  test('you cannot delete yourself', async () => {
    const res = await request(`/api/hosts/${dan.id}`, {
      method: 'DELETE',
      headers: asAccount(dan),
    });
    assert.equal(res.status, 422);
    assert.ok(userById(dan.id));
  });

  test('and a host cannot delete anyone', async () => {
    const res = await request(`/api/hosts/${bruno.id}`, {
      method: 'DELETE',
      headers: asAccount(ana),
    });
    assert.equal(res.status, 403);
    assert.ok(userById(bruno.id));
  });
});

describe('a party’s lifecycle', () => {
  test('draft → live → done, moved by hand', async () => {
    const id = partyFor(ana.id, 'Lifecycle party', 'draft');

    const open = await patchParty(dan, id, { status: 'live' });
    assert.equal(open.status, 200);
    assert.equal(((await open.json()) as { event: { status: string } }).event.status, 'live');

    const close = await patchParty(dan, id, { status: 'done' });
    assert.equal(((await close.json()) as { event: { status: string } }).event.status, 'done');
  });

  test('renaming and dating it', async () => {
    const id = partyFor(ana.id, 'Before');
    const res = await patchParty(dan, id, { name: 'After', startsAt: 1_800_000_000_000 });
    assert.equal(res.status, 200);
    const { event } = (await res.json()) as { event: { name: string; startsAt: number } };
    assert.equal(event.name, 'After');
    assert.equal(event.startsAt, 1_800_000_000_000);
  });

  test('a party still needs a name', async () => {
    const id = partyFor(ana.id, 'Named');
    assert.equal((await patchParty(dan, id, { name: '   ' })).status, 422);
  });

  test('an unknown status is refused', async () => {
    const id = partyFor(ana.id, 'Statused');
    assert.equal((await patchParty(dan, id, { status: 'cancelled' })).status, 422);
  });

  test('the host may not open, close, rename or delete their own party', async () => {
    // "Watch the queue, nothing more". This is the line, stated four ways because it
    // is the one most likely to be widened by someone being helpful.
    const id = partyFor(ana.id, "Ana's own");
    assert.equal((await patchParty(ana, id, { status: 'live' })).status, 403);
    assert.equal((await patchParty(ana, id, { status: 'done' })).status, 403);
    assert.equal((await patchParty(ana, id, { name: 'Mine now' })).status, 403);
    assert.equal(
      (await request(`/api/events/${id}`, { method: 'DELETE', headers: asAccount(ana) })).status,
      403,
    );
  });

  test("and cannot touch another host's party at all", async () => {
    const id = partyFor(bruno.id, "Bruno's");
    // 404 rather than 403 — the id must not confirm the party exists.
    assert.equal((await patchParty(ana, id, { name: 'Hijacked' })).status, 404);
    assert.equal((await request(`/api/events/${id}`, { headers: asAccount(ana) })).status, 404);
  });

  test('deleting a party leaves the cupboard alone', async () => {
    // The cupboard belongs to the host and outlives every party they have. That is
    // the whole reason it was moved off the event.
    const id = partyFor(ana.id, 'Deletable');
    await request(`/api/hosts/${ana.id}/stock`, send('PUT', { stock: ['Gin'] }, asAccount(ana)));

    assert.equal(
      (await request(`/api/events/${id}`, { method: 'DELETE', headers: asAccount(dan) })).status,
      200,
    );
    const stock = await request(`/api/hosts/${ana.id}/stock`, { headers: asAccount(ana) });
    const body = (await stock.json()) as { stock: string[] };
    assert.deepEqual(body.stock, ['Gin'], 'the party went; the gin stayed');
  });
});
