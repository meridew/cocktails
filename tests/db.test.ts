/**
 * Persistence layer. `createDb(':memory:')` gives a fresh schema per test.
 *
 * Note: node:sqlite returns null-prototype row objects, so spread them ({...row})
 * before a deepEqual against a plain object literal.
 */
import { test, describe, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LIMITS, type PushSubscriptionJSON } from '$lib/shared';
import { createDb, type Db } from '$lib/server/db';
import { user } from '$lib/server/schema.auth';

let db: Db;
/** Every test gets its own party. Scope is a required argument now, so there is
 *  nowhere to hide an unscoped query. */
let ev: string;
/** The host who owns it. A party without one no longer exists — see schema.ts. */
let host: string;

/**
 * A person, inserted straight into Better Auth's table.
 *
 * This file is the one place that legitimately bypasses the front door: it tests
 * the persistence layer through `createDb`, with no HTTP and no Better Auth in
 * play. Everywhere else builds people through `tests/fixtures/people`, which signs
 * them up for real.
 */
function makeUser(db: Db, id: string, role: 'admin' | 'host' = 'host'): string {
  const at = new Date();
  db.orm
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      role,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return id;
}

beforeEach(() => {
  db = createDb(':memory:');
  host = makeUser(db, 'db-host');
  ev = db.createEvent({ hostUserId: host, name: 'Test party' }).id;
});

// Temp-file databases must have their handles closed before the directory can be
// removed (Windows refuses to unlink a file that is still open).
const tmpDirs: string[] = [];
const openHandles: Db[] = [];
afterAll(() => {
  for (const handle of openHandles) {
    try {
      handle.raw.close();
    } catch {
      /* already closed */
    }
  }
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cocktails-test-'));
  tmpDirs.push(dir);
  return join(dir, 'old.sqlite');
}
/** `createDb` against a temp file, registered for cleanup. */
function openTempDb(path: string): Db {
  const handle = createDb(path);
  openHandles.push(handle);
  return handle;
}

const sub = (endpoint: string): PushSubscriptionJSON => ({
  endpoint,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
});

describe('schema', () => {
  /**
   * The schema is declared, not migrated into place. The old suite proved that a
   * deployed database could be upgraded — column adds, two table rebuilds — but
   * that machinery is gone (see db.ts): the database is disposable, so a schema
   * change is an edit plus `npm run db:reset`. What's left to assert is that the
   * declared shape is the one intended, because nothing else pins it down now.
   */
  const cols = (t: string): { name: string; notnull: number; pk: number }[] =>
    db.raw.prepare(`PRAGMA table_info(${t})`).all() as never;
  const names = (t: string): string[] => cols(t).map((c) => c.name);

  test('every table exists', () => {
    const tables = (
      db.raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of ['orders', 'subscriptions', 'staff', 'staff_sessions', 'event_guest']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  test('orders carries only what is used', () => {
    // The order is the declaration order now. It used to end with `event_id`
    // because SQLite's ALTER TABLE ADD COLUMN can only append and the tenancy
    // migration bolted it on; the schema was rebuilt from scratch on a green field,
    // so the table finally reads the way it is written.
    assert.deepEqual(names('orders'), [
      'id',
      'event_id',
      'name',
      'items',
      'note',
      'status',
      'device_id',
      'bumped_at',
      'handoff',
      'created_at',
      'updated_at',
    ]);
    // user_id was added for an accounts feature that never happened.
    assert.ok(!names('orders').includes('user_id'), 'dead column');
  });

  test('subscriptions is keyed by device + endpoint + role', () => {
    // Role is part of the key because one device legitimately holds both: the host
    // runs the bar and also orders drinks. Without it, registering one role
    // overwrote the other and silently killed its pushes.
    const pk = cols('subscriptions')
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    assert.deepEqual(pk, ['device_id', 'endpoint', 'role']);
  });

  test('staff.user_id is nullable, because a helper genuinely has no account', () => {
    // The whole appeal of a join code is that it demands nothing be invented or
    // remembered. `user_id` is how a row *gains* an account, not a requirement —
    // which is also why this table is the plan's `event_member` rather than a
    // second membership table only account-holders could appear in.
    const found = cols('staff').find((c) => c.name === 'user_id');
    assert.equal(found?.notnull, 0, 'staff.user_id should be nullable');
  });

  test('how someone joined is recorded separately from who approved them', () => {
    // These were one column, with the literal string 'join-code' as a sentinel in
    // approved_by — which conflated "granted by a code" with "granted by a person".
    assert.ok(names('staff').includes('joined_via'));
    assert.ok(names('staff').includes('approved_by'));
  });

  test('several helpers coexist at one party, each on their own device', () => {
    // The old version of this test proved many NULL emails could share a UNIQUE
    // index. There is no email column any more — a helper's identity is a device
    // and their credential is a session — so what's worth asserting is that the
    // party can hold several of them at once.
    for (const id of ['h1', 'h2', 'h3']) {
      db.createStaff({ id, eventId: ev, displayName: id, deviceId: id, status: 'active' });
    }
    assert.equal(db.listStaff(ev).length, 3);
  });

  test('a staff row carries no credential of its own', () => {
    // Regression guard for the columns that were deleted. If `email` or
    // `password_hash` ever reappear here, an identity has leaked back into a table
    // that describes a shift.
    const columns = names('staff');
    assert.ok(!columns.includes('email'), 'staff must not hold a login identity');
    assert.ok(!columns.includes('password_hash'), 'staff must not hold a credential');
    assert.ok(!columns.includes('role'), 'a role is a fact about a person, not a shift');
  });
});

describe('orders', () => {
  const newOrder = (name = 'Dan', deviceId?: string) =>
    db.createOrder(ev, { name, items: [{ name: 'Mojito', qty: 1 }], note: '', deviceId });

  test('createOrder starts pending with matching timestamps', () => {
    const order = newOrder();
    assert.equal(order.status, 'pending');
    assert.match(order.id, /^[0-9a-f]{12}$/);
    assert.equal(order.createdAt, order.updatedAt);
    assert.deepEqual(order.items, [{ name: 'Mojito', qty: 1 }]);
  });

  test('a corrupt items column yields an empty list rather than throwing', () => {
    db.raw
      .prepare(
        `INSERT INTO orders (id,event_id,name,items,note,status,created_at,updated_at)
         VALUES ('bad','${ev}','Eve','not json','','pending',1,1)`,
      )
      .run();
    const orders = db.listOrders(ev);
    assert.equal(orders.length, 1);
    assert.deepEqual(orders[0]?.items, [], 'must degrade to [] at the API boundary');
  });

  test('setOrderStatus advances the order and bumps updatedAt', () => {
    const order = newOrder();
    const updated = db.setOrderStatus(ev, order.id, 'making');
    assert.equal(updated?.status, 'making');
    assert.ok((updated?.updatedAt ?? 0) >= order.updatedAt);
  });

  test('unknown ids report absence rather than throwing', () => {
    assert.equal(db.setOrderStatus(ev, 'nope', 'making'), null);
    assert.equal(db.deleteOrder(ev, 'nope'), false);
    assert.equal(db.orderDeviceId(ev, 'nope'), null);
  });

  test('deleteOrder removes exactly one row', () => {
    const a = newOrder('A');
    newOrder('B');
    assert.equal(db.deleteOrder(ev, a.id), true);
    assert.deepEqual(
      db.listOrders(ev).map((o) => o.name),
      ['B'],
    );
  });

  test('clearOrders removes done rows, or everything', () => {
    const done = newOrder('Done');
    newOrder('Pending');
    db.setOrderStatus(ev, done.id, 'done');

    db.clearOrders(ev, 'done');
    assert.deepEqual(
      db.listOrders(ev).map((o) => o.name),
      ['Pending'],
    );

    db.clearOrders(ev, 'all');
    assert.equal(db.listOrders(ev).length, 0);
  });

  test('orderDeviceId returns the placing device, or null when anonymous', () => {
    assert.equal(db.orderDeviceId(ev, newOrder('WithDevice', 'dev-9').id), 'dev-9');
    assert.equal(db.orderDeviceId(ev, newOrder('NoDevice').id), null);
  });

  test('the cap evicts finished orders before live ones', () => {
    // Flooding the public endpoint must not delete the party's live queue, so a
    // 'done' row is always the first candidate regardless of age.
    const done = newOrder('AlreadyServed');
    db.setOrderStatus(ev, done.id, 'done');
    newOrder('StillWaiting');

    for (let i = 0; i < LIMITS.maxOrders - 2; i++) {
      db.createOrder(ev, { name: `Filler${i}`, items: [{ name: 'Mojito', qty: 1 }], note: '' });
    }
    assert.equal(db.listOrders(ev).length, LIMITS.maxOrders);

    db.createOrder(ev, { name: 'Overflow', items: [{ name: 'Wine', qty: 1 }], note: '' });
    const names = db.listOrders(ev).map((o) => o.name);
    assert.ok(!names.includes('AlreadyServed'), 'the done order should have been evicted');
    assert.ok(
      names.includes('StillWaiting'),
      'a live order must not be evicted while done rows exist',
    );
  });

  test('the order cap evicts to stay at the limit', () => {
    for (let i = 0; i < LIMITS.maxOrders; i++) {
      db.createOrder(ev, { name: `G${i}`, items: [{ name: 'Mojito', qty: 1 }], note: '' });
    }
    const before = db.listOrders(ev);
    assert.equal(before.length, LIMITS.maxOrders);

    const fresh = db.createOrder(ev, {
      name: 'Latest',
      items: [{ name: 'Wine', qty: 1 }],
      note: '',
    });
    const remaining = db.listOrders(ev);
    assert.equal(remaining.length, LIMITS.maxOrders, 'must not exceed the cap');
    assert.ok(
      remaining.some((o) => o.id === fresh.id),
      'the new order must be present',
    );
    assert.equal(
      before.filter((o) => !remaining.some((a) => a.id === o.id)).length,
      1,
      'exactly one prior order should have been evicted',
    );
  });
});

describe('subscriptions', () => {
  test('re-subscribing the same device+endpoint+role updates in place', () => {
    const endpoint = sub('https://fcm.googleapis.com/fcm/send/a');
    db.saveSubscription('dev-1', 'guest', endpoint);
    db.saveSubscription('dev-1', 'guest', endpoint);
    const rows = db.subscriptionsForDevice('dev-1');
    assert.equal(rows.length, 1, 'the composite key should have collapsed these');
    assert.equal(rows[0]?.role, 'guest');
  });

  test('one device holds both roles on the same endpoint', () => {
    // The host runs the bar AND orders drinks. With role outside the primary key,
    // enabling one silently deleted the other's subscription.
    const endpoint = sub('https://fcm.googleapis.com/fcm/send/a');
    db.saveSubscription('dev-host', 'guest', endpoint);
    db.saveSubscription('dev-host', 'bartender', endpoint);

    assert.equal(db.subscriptionsForDevice('dev-host').length, 2);
    assert.equal(db.subscriptionsForRole('guest').length, 1, 'guest push must survive');
    assert.equal(db.subscriptionsForRole('bartender').length, 1, 'bar alerts must survive');
  });

  test('a second endpoint for the same device is a separate row', () => {
    db.saveSubscription('dev-1', 'guest', sub('https://fcm.googleapis.com/fcm/send/a'));
    db.saveSubscription('dev-1', 'guest', sub('https://fcm.googleapis.com/fcm/send/b'));
    assert.equal(db.subscriptionsForDevice('dev-1').length, 2);
  });

  test('lookups filter by role and parse the stored subscription back', () => {
    db.saveSubscription('dev-guest', 'guest', sub('https://fcm.googleapis.com/fcm/send/g'));
    db.saveSubscription('dev-staff', 'bartender', sub('https://fcm.googleapis.com/fcm/send/s'));

    const staff = db.subscriptionsForRole('bartender');
    assert.equal(staff.length, 1);
    assert.equal(staff[0]?.deviceId, 'dev-staff');
    assert.deepEqual(staff[0]?.subscription, sub('https://fcm.googleapis.com/fcm/send/s'));
    assert.equal(db.subscriptionsForRole('guest').length, 1);
  });

  test('deleteSubscription removes one; an unknown pair is a silent no-op', () => {
    db.saveSubscription('dev-1', 'guest', sub('https://fcm.googleapis.com/fcm/send/a'));
    db.deleteSubscription('dev-1', 'https://fcm.googleapis.com/fcm/send/a');
    assert.equal(db.subscriptionsForDevice('dev-1').length, 0);
    assert.doesNotThrow(() =>
      db.deleteSubscription('dev-1', 'https://fcm.googleapis.com/fcm/send/gone'),
    );
  });
});
