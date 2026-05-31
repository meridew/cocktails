import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ClearWhich,
  Order,
  OrderItem,
  OrderStatus,
  PushSubscriptionJSON,
  SubscriberRole,
  SubscriptionRecord,
} from '@cocktails/shared';
import { config } from './config.ts';

const dbFile = resolve(process.cwd(), config.dbPath);
mkdirSync(dirname(dbFile), { recursive: true });

const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    items      TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending',
    device_id  TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    device_id    TEXT NOT NULL,
    role         TEXT NOT NULL,
    subscription TEXT NOT NULL,
    endpoint     TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (device_id, endpoint)
  );
`);

export const now = (): number => Date.now();
export const genId = (): string => randomBytes(6).toString('hex');

interface OrderRow {
  id: string;
  name: string;
  items: string;
  note: string;
  status: string;
  device_id: string | null;
  created_at: number;
  updated_at: number;
}

function rowToOrder(r: OrderRow): Order {
  let items: OrderItem[] = [];
  try {
    const parsed = JSON.parse(r.items) as unknown;
    if (Array.isArray(parsed)) items = parsed as OrderItem[];
  } catch {
    /* corrupt row → empty items, never throw at the API boundary */
  }
  return {
    id: r.id,
    name: r.name,
    items,
    note: r.note,
    status: r.status as OrderStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const stInsertOrder = db.prepare(
  `INSERT INTO orders (id, name, items, note, status, device_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
);
const stListOrders = db.prepare(`SELECT * FROM orders ORDER BY created_at ASC`);
const stGetOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`);
const stCountOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders`);
const stOldestId = db.prepare(`SELECT id FROM orders ORDER BY created_at ASC LIMIT 1`);
const stSetStatus = db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`);
const stDeleteOrder = db.prepare(`DELETE FROM orders WHERE id = ?`);
const stClearDone = db.prepare(`DELETE FROM orders WHERE status = 'done'`);
const stClearAll = db.prepare(`DELETE FROM orders`);

export function createOrder(input: {
  name: string;
  items: OrderItem[];
  note: string;
  deviceId?: string;
}): Order {
  const count = (stCountOrders.get() as { n: number }).n;
  if (count >= 500) {
    const oldest = stOldestId.get() as { id: string } | undefined;
    if (oldest) stDeleteOrder.run(oldest.id);
  }
  const ts = now();
  const id = genId();
  stInsertOrder.run(
    id,
    input.name,
    JSON.stringify(input.items),
    input.note,
    input.deviceId ?? null,
    ts,
    ts,
  );
  return rowToOrder(stGetOrder.get(id) as unknown as OrderRow);
}

export function listOrders(): Order[] {
  return (stListOrders.all() as unknown as OrderRow[]).map(rowToOrder);
}

export function getOrder(id: string): Order | null {
  const row = stGetOrder.get(id) as unknown as OrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function setOrderStatus(id: string, status: OrderStatus): Order | null {
  const res = stSetStatus.run(status, now(), id);
  if (res.changes === 0) return null;
  return rowToOrder(stGetOrder.get(id) as unknown as OrderRow);
}

export function deleteOrder(id: string): boolean {
  return stDeleteOrder.run(id).changes > 0;
}

export function clearOrders(which: ClearWhich): void {
  if (which === 'all') stClearAll.run();
  else stClearDone.run();
}

// ---- subscriptions (Phase 3 plumbing, present now so the schema is stable) --

const stUpsertSub = db.prepare(
  `INSERT INTO subscriptions (device_id, role, subscription, endpoint, created_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(device_id, endpoint) DO UPDATE SET
     role = excluded.role,
     subscription = excluded.subscription`,
);
const stSubsByDevice = db.prepare(`SELECT * FROM subscriptions WHERE device_id = ?`);
const stSubsByRole = db.prepare(`SELECT * FROM subscriptions WHERE role = ?`);

interface SubRow {
  device_id: string;
  role: string;
  subscription: string;
  endpoint: string;
  created_at: number;
}

function rowToSub(r: SubRow): SubscriptionRecord {
  return {
    deviceId: r.device_id,
    role: r.role as SubscriberRole,
    subscription: JSON.parse(r.subscription) as PushSubscriptionJSON,
    createdAt: r.created_at,
  };
}

export function saveSubscription(
  deviceId: string,
  role: SubscriberRole,
  subscription: PushSubscriptionJSON,
): void {
  stUpsertSub.run(deviceId, role, JSON.stringify(subscription), subscription.endpoint, now());
}

export function subscriptionsForDevice(deviceId: string): SubscriptionRecord[] {
  return (stSubsByDevice.all(deviceId) as unknown as SubRow[]).map(rowToSub);
}

export function subscriptionsForRole(role: SubscriberRole): SubscriptionRecord[] {
  return (stSubsByRole.all(role) as unknown as SubRow[]).map(rowToSub);
}
