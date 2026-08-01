/**
 * The capability matrix — phase 0's gate.
 *
 * **Written from PLATFORM-PLAN §6, not from `permissions.ts`.** That distinction is
 * the whole value: a table derived from the implementation agrees with it by
 * construction and proves nothing. This one is transcribed from the document, so if
 * the code and the plan ever disagree, this fails and somebody has to decide which
 * was right.
 *
 * The previous model had one axis and this test could not have existed — "can a
 * bartender edit stock" had no answer without also saying *whose* stock, and there
 * was nowhere to put that. Every row below names a subject.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import {
  ANONYMOUS,
  CAPABILITIES,
  SCOPE_OF,
  can,
  host,
  party,
  platform,
  type Actor,
  type Capability,
} from '$lib/shared';

const PARTY = 'party-1';
const OTHER_PARTY = 'party-2';
const HOST_ID = 'host-1';
const OTHER_HOST = 'host-2';

/** The five people who can hold anything, at the party or host under test. */
const admin: Actor = { account: { id: 'dan', role: 'admin' }, party: null };
const adminAtBar: Actor = {
  account: { id: 'dan', role: 'admin' },
  party: { id: PARTY, role: 'staff' },
};
const owner: Actor = {
  account: { id: HOST_ID, role: 'host' },
  party: { id: PARTY, role: 'owner' },
};
const staff: Actor = { account: null, party: { id: PARTY, role: 'staff' } };
const stranger: Actor = { account: { id: OTHER_HOST, role: 'host' }, party: null };

/** §6's table, transcribed. `true` means the capability is held over the subject. */
const EXPECTED: Record<Capability, { admin: boolean; owner: boolean; staff: boolean }> = {
  'orders:read': { admin: true, owner: true, staff: true },
  'orders:advance': { admin: true, owner: false, staff: true },
  'orders:delete': { admin: true, owner: false, staff: true },
  'orders:clear': { admin: true, owner: false, staff: true },
  'analytics:read': { admin: true, owner: true, staff: false },
  'notifications:read': { admin: true, owner: true, staff: false },
  'notifications:control': { admin: true, owner: false, staff: false },
  // Letting a guest in is bar work: whoever is pouring is looking at the room. A
  // host still only watches — the same line every other row on this table draws.
  'guests:read': { admin: true, owner: false, staff: true },
  'guests:admit': { admin: true, owner: false, staff: true },
  'staff:read': { admin: true, owner: false, staff: false },
  'staff:approve': { admin: true, owner: false, staff: false },
  'staff:revoke': { admin: true, owner: false, staff: false },
  'stock:read': { admin: true, owner: true, staff: false },
  'stock:edit': { admin: true, owner: true, staff: false },
  'party:create': { admin: true, owner: false, staff: false },
  'party:edit': { admin: true, owner: false, staff: false },
  'party:open': { admin: true, owner: false, staff: false },
  'party:close': { admin: true, owner: false, staff: false },
  'party:delete': { admin: true, owner: false, staff: false },
  'menu:curate': { admin: true, owner: true, staff: false },
  'host:list': { admin: true, owner: false, staff: false },
  'host:suspend': { admin: true, owner: false, staff: false },
  'host:delete': { admin: true, owner: false, staff: false },
  'admin:grant': { admin: true, owner: false, staff: false },
};

/** The subject a capability is naturally asked about, for the actor under test. */
const subjectFor = (cap: Capability, userId = HOST_ID) =>
  SCOPE_OF[cap] === 'party' ? party(PARTY) : SCOPE_OF[cap] === 'host' ? host(userId) : platform();

describe('the table matches the plan', () => {
  test('every capability appears in both the code and this transcription', () => {
    assert.deepEqual([...CAPABILITIES].sort(), Object.keys(EXPECTED).sort());
  });

  test('Admin holds everything, everywhere', () => {
    for (const cap of CAPABILITIES) {
      assert.equal(can(admin, cap, subjectFor(cap)), true, `admin lacks ${cap}`);
      // Including at a party they were never added to — that is what "Admin sees
      // every party" means, and why Dan needs no join code.
      if (SCOPE_OF[cap] === 'party') {
        assert.equal(can(admin, cap, party(OTHER_PARTY)), true, `admin lacks ${cap} elsewhere`);
      }
      if (SCOPE_OF[cap] === 'host') {
        assert.equal(
          can(admin, cap, host(OTHER_HOST)),
          true,
          `admin lacks ${cap} for another host`,
        );
      }
    }
  });

  test('a host owns their party and their cupboard, and nothing else', () => {
    for (const cap of CAPABILITIES) {
      const expected = EXPECTED[cap].owner;
      assert.equal(can(owner, cap, subjectFor(cap)), expected, `owner × ${cap}`);
    }
  });

  test('staff run the service and decide nothing', () => {
    for (const cap of CAPABILITIES) {
      const expected = EXPECTED[cap].staff;
      assert.equal(can(staff, cap, subjectFor(cap)), expected, `staff × ${cap}`);
    }
  });

  test('a host may watch their queue but not touch it', () => {
    // The whole of "watch the queue, nothing more", stated as its own case because
    // it is the line most likely to be widened by accident.
    assert.equal(can(owner, 'orders:read', party(PARTY)), true);
    for (const cap of ['orders:advance', 'orders:delete', 'orders:clear'] as const) {
      assert.equal(can(owner, cap, party(PARTY)), false, `a host must not hold ${cap}`);
    }
  });

  test('an admin behind the bar is still an admin', () => {
    // Holding a staff row must never *narrow* what an account can do.
    for (const cap of CAPABILITIES) {
      assert.equal(can(adminAtBar, cap, subjectFor(cap)), true, `admin-at-bar lacks ${cap}`);
    }
  });
});

describe('the scope is load-bearing', () => {
  test('nobody holds anything at a party they are not at', () => {
    for (const actor of [owner, staff]) {
      for (const cap of CAPABILITIES.filter((c) => SCOPE_OF[c] === 'party')) {
        assert.equal(can(actor, cap, party(OTHER_PARTY)), false, `${cap} leaked to another party`);
      }
    }
  });

  test("a host cannot touch another host's cupboard", () => {
    assert.equal(can(owner, 'stock:read', host(HOST_ID)), true);
    assert.equal(can(owner, 'stock:edit', host(HOST_ID)), true);
    assert.equal(can(owner, 'stock:read', host(OTHER_HOST)), false);
    assert.equal(can(owner, 'stock:edit', host(OTHER_HOST)), false);
  });

  test('asking with the wrong kind of subject is refused, not guessed at', () => {
    // A mismatched scope is a programming error. Answering it would be the widest
    // possible hole, because the question asked isn't the question checked.
    assert.equal(can(admin, 'orders:read', platform()), false);
    assert.equal(can(admin, 'host:list', party(PARTY)), false);
    assert.equal(can(admin, 'stock:edit', party(PARTY)), false);
  });
});

describe('nobody is nobody', () => {
  test('an anonymous caller holds nothing at all', () => {
    for (const cap of CAPABILITIES) {
      assert.equal(can(ANONYMOUS, cap, subjectFor(cap)), false, `anonymous held ${cap}`);
      assert.equal(can(null, cap, subjectFor(cap)), false);
      assert.equal(can(undefined, cap, subjectFor(cap)), false);
    }
  });

  test('a signed-in stranger holds nothing either', () => {
    for (const cap of CAPABILITIES) {
      assert.equal(can(stranger, cap, subjectFor(cap)), false, `a stranger held ${cap}`);
    }
  });

  test('a device-only helper has no account powers', () => {
    // Their party role is real; their account is genuinely null, and every
    // platform- and host-scoped capability has to fall through that.
    assert.equal(staff.account, null);
    for (const cap of CAPABILITIES.filter((c) => SCOPE_OF[c] !== 'party')) {
      assert.equal(can(staff, cap, subjectFor(cap)), false, `a helper held ${cap}`);
    }
  });
});
