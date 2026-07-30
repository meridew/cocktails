/**
 * Persistence layer. Uses `createDb(':memory:')` for a fresh schema per test, and
 * a real temp file for the migration tests (which must open a pre-seeded DB).
 *
 * Note: node:sqlite returns null-prototype row objects, so spread them ({...row})
 * before a deepEqual against a plain object literal.
 */
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LIMITS, type PushSubscriptionJSON } from '@cocktails/shared';
import { createDb, type Db } from '../src/db.ts';

let db: Db;
beforeEach(() => {
  db = createDb(':memory:');
});

// Temp-file databases must have their handles closed before the directory can be
// removed (Windows refuses to unlink a file that is still open).
const tmpDirs: string[] = [];
const openHandles: Db[] = [];
after(() => {
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

describe('schema + migrations', () => {
  test('a fresh database has every table and column', () => {
    const cols = (t: string): string[] =>
      (db.raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name);

    assert.ok(cols('orders').includes('user_id'));
    assert.ok(cols('subscriptions').includes('transport'));
    assert.ok(cols('subscriptions').includes('platform'));
    assert.ok(cols('staff').includes('password_hash'));
    assert.ok(cols('staff_sessions').includes('expires_at'));
  });

  test('migrates a pre-existing old-schema database without losing rows', () => {
    const path = tempDbPath();

    // Build the schema as it existed before user_id / transport / platform.
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE orders (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
        device_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE subscriptions (
        device_id TEXT NOT NULL, role TEXT NOT NULL, subscription TEXT NOT NULL,
        endpoint TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, endpoint)
      );
    `);
    old
      .prepare(
        `INSERT INTO orders (id,name,items,note,status,device_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        'keep1',
        'Dan',
        '[{"name":"Margarita","qty":2}]',
        'no salt',
        'making',
        'dev-1',
        1000,
        1000,
      );
    old
      .prepare(
        `INSERT INTO subscriptions (device_id,role,subscription,endpoint,created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        'dev-1',
        'guest',
        JSON.stringify(sub('https://push.example/a')),
        'https://push.example/a',
        1000,
      );
    old.close();

    const migrated = openTempDb(path);
    const cols = (t: string): string[] =>
      (migrated.raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
        (r) => r.name,
      );
    assert.ok(cols('orders').includes('user_id'), 'orders.user_id was not added');
    assert.ok(cols('subscriptions').includes('transport'));
    assert.ok(cols('subscriptions').includes('platform'));

    // The pre-existing rows survived, and the new columns got their defaults.
    const orders = migrated.listOrders();
    assert.equal(orders.length, 1);
    assert.equal(orders[0]?.id, 'keep1');
    assert.equal(orders[0]?.status, 'making');
    assert.deepEqual(orders[0]?.items, [{ name: 'Margarita', qty: 2 }]);

    const subs = migrated.subscriptionsForDevice('dev-1');
    assert.equal(subs.length, 1);
    assert.equal(subs[0]?.transport, 'webpush');
    assert.equal(subs[0]?.platform, 'web');
  });

  test('migrating twice is a no-op (idempotent)', () => {
    const path = tempDbPath();
    openTempDb(path);
    assert.doesNotThrow(() => openTempDb(path), 'a second migration pass must not throw');
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

  test('the order cap evicts to stay at the limit', () => {
    for (let i = 0; i < LIMITS.maxOrders; i++) {
      db.createOrder({ name: `G${i}`, items: [{ name: 'Mojito', qty: 1 }], note: '' });
    }
    const before = db.listOrders();
    assert.equal(before.length, LIMITS.maxOrders);

    const fresh = db.createOrder({ name: 'Latest', items: [{ name: 'Wine', qty: 1 }], note: '' });
    const after = db.listOrders();
    assert.equal(after.length, LIMITS.maxOrders, 'must not exceed the cap');
    assert.ok(
      after.some((o) => o.id === fresh.id),
      'the new order must be present',
    );
    assert.equal(
      before.filter((o) => !after.some((a) => a.id === o.id)).length,
      1,
      'exactly one prior order should have been evicted',
    );
  });
});

describe('subscriptions', () => {
  test('re-subscribing the same device+endpoint updates in place', () => {
    db.saveSubscription('dev-1', 'guest', sub('https://push.example/a'));
    db.saveSubscription('dev-1', 'bartender', sub('https://push.example/a'));
    const rows = db.subscriptionsForDevice('dev-1');
    assert.equal(rows.length, 1, 'the composite key should have collapsed these');
    assert.equal(rows[0]?.role, 'bartender');
  });

  test('a second endpoint for the same device is a separate row', () => {
    db.saveSubscription('dev-1', 'guest', sub('https://push.example/a'));
    db.saveSubscription('dev-1', 'guest', sub('https://push.example/b'));
    assert.equal(db.subscriptionsForDevice('dev-1').length, 2);
  });

  test('lookups filter by role and parse the stored subscription back', () => {
    db.saveSubscription('dev-guest', 'guest', sub('https://push.example/g'));
    db.saveSubscription('dev-staff', 'bartender', sub('https://push.example/s'));

    const staff = db.subscriptionsForRole('bartender');
    assert.equal(staff.length, 1);
    assert.equal(staff[0]?.deviceId, 'dev-staff');
    assert.deepEqual(staff[0]?.subscription, sub('https://push.example/s'));
    assert.equal(db.subscriptionsForRole('guest').length, 1);
  });

  test('deleteSubscription removes one; an unknown pair is a silent no-op', () => {
    db.saveSubscription('dev-1', 'guest', sub('https://push.example/a'));
    db.deleteSubscription('dev-1', 'https://push.example/a');
    assert.equal(db.subscriptionsForDevice('dev-1').length, 0);
    assert.doesNotThrow(() => db.deleteSubscription('dev-1', 'https://push.example/gone'));
  });
});
