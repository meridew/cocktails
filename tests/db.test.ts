/**
 * Persistence layer. `createDb(':memory:')` gives a fresh schema per test.
 *
 * Note: node:sqlite returns null-prototype row objects, so spread them ({...row})
 * before a deepEqual against a plain object literal.
 */
import { test, describe, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LIMITS, type PushSubscriptionJSON } from '$lib/shared';
import { createDb, type Db } from '$lib/server/db';

let db: Db;
beforeEach(() => {
  db = createDb(':memory:');
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
    for (const t of ['orders', 'subscriptions', 'staff', 'staff_sessions', 'join_codes']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  test('orders carries only what is used', () => {
    assert.deepEqual(names('orders'), [
      'id',
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

  test('staff.email and password_hash are nullable, so helpers need neither', () => {
    // A helper's identity is a device and their credential is a session; only an
    // admin has an email and a password.
    for (const col of ['email', 'password_hash']) {
      const found = cols('staff').find((c) => c.name === col);
      assert.equal(found?.notnull, 0, `staff.${col} should be nullable`);
    }
  });

  test('how someone joined is recorded separately from who approved them', () => {
    // These were one column, with the literal string 'join-code' as a sentinel in
    // approved_by — which conflated "granted by a code" with "granted by a person".
    assert.ok(names('staff').includes('joined_via'));
    assert.ok(names('staff').includes('approved_by'));
  });

  test('several helpers can coexist without emails', () => {
    // SQLite allows many NULLs under a UNIQUE index; this is what makes the
    // nullable email safe rather than a collision waiting to happen.
    for (const id of ['h1', 'h2', 'h3']) {
      db.createStaff({ id, displayName: id, deviceId: id, role: 'bartender', status: 'active' });
    }
    assert.equal(db.listStaff().length, 3);
  });
});

describe('orders', () => {
  const newOrder = (name = 'Dan', deviceId?: string) =>
    db.createOrder({ name, items: [{ name: 'Mojito', qty: 1 }], note: '', deviceId });

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
        `INSERT INTO orders (id,name,items,note,status,created_at,updated_at)
         VALUES ('bad','Eve','not json','','pending',1,1)`,
      )
      .run();
    const orders = db.listOrders();
    assert.equal(orders.length, 1);
    assert.deepEqual(orders[0]?.items, [], 'must degrade to [] at the API boundary');
  });

  test('setOrderStatus advances the order and bumps updatedAt', () => {
    const order = newOrder();
    const updated = db.setOrderStatus(order.id, 'making');
    assert.equal(updated?.status, 'making');
    assert.ok((updated?.updatedAt ?? 0) >= order.updatedAt);
  });

  test('unknown ids report absence rather than throwing', () => {
    assert.equal(db.setOrderStatus('nope', 'making'), null);
    assert.equal(db.deleteOrder('nope'), false);
    assert.equal(db.orderDeviceId('nope'), null);
  });

  test('deleteOrder removes exactly one row', () => {
    const a = newOrder('A');
    newOrder('B');
    assert.equal(db.deleteOrder(a.id), true);
    assert.deepEqual(
      db.listOrders().map((o) => o.name),
      ['B'],
    );
  });

  test('clearOrders removes done rows, or everything', () => {
    const done = newOrder('Done');
    newOrder('Pending');
    db.setOrderStatus(done.id, 'done');

    db.clearOrders('done');
    assert.deepEqual(
      db.listOrders().map((o) => o.name),
      ['Pending'],
    );

    db.clearOrders('all');
    assert.equal(db.listOrders().length, 0);
  });

  test('orderDeviceId returns the placing device, or null when anonymous', () => {
    assert.equal(db.orderDeviceId(newOrder('WithDevice', 'dev-9').id), 'dev-9');
    assert.equal(db.orderDeviceId(newOrder('NoDevice').id), null);
  });

  test('the cap evicts finished orders before live ones', () => {
    // Flooding the public endpoint must not delete the party's live queue, so a
    // 'done' row is always the first candidate regardless of age.
    const done = newOrder('AlreadyServed');
    db.setOrderStatus(done.id, 'done');
    newOrder('StillWaiting');

    for (let i = 0; i < LIMITS.maxOrders - 2; i++) {
      db.createOrder({ name: `Filler${i}`, items: [{ name: 'Mojito', qty: 1 }], note: '' });
    }
    assert.equal(db.listOrders().length, LIMITS.maxOrders);

    db.createOrder({ name: 'Overflow', items: [{ name: 'Wine', qty: 1 }], note: '' });
    const names = db.listOrders().map((o) => o.name);
    assert.ok(!names.includes('AlreadyServed'), 'the done order should have been evicted');
    assert.ok(
      names.includes('StillWaiting'),
      'a live order must not be evicted while done rows exist',
    );
  });

  test('the order cap evicts to stay at the limit', () => {
    for (let i = 0; i < LIMITS.maxOrders; i++) {
      db.createOrder({ name: `G${i}`, items: [{ name: 'Mojito', qty: 1 }], note: '' });
    }
    const before = db.listOrders();
    assert.equal(before.length, LIMITS.maxOrders);

    const fresh = db.createOrder({ name: 'Latest', items: [{ name: 'Wine', qty: 1 }], note: '' });
    const remaining = db.listOrders();
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
