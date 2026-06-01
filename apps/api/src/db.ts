import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ClearWhich,
  Order,
  OrderItem,
  OrderStatus,
  Platform,
  PushSubscriptionJSON,
  SubscriberRole,
  SubscriptionRecord,
  SubscriptionTransport,
} from '@cocktails/shared';
import { LIMITS } from '@cocktails/shared';
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
    user_id    TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    device_id    TEXT NOT NULL,
    role         TEXT NOT NULL,
    subscription TEXT NOT NULL,
    endpoint     TEXT NOT NULL,
    transport    TEXT NOT NULL DEFAULT 'webpush',
    platform     TEXT NOT NULL DEFAULT 'web',
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (device_id, endpoint)
  );
  CREATE TABLE IF NOT EXISTS staff (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'bartender',
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff_sessions (
    token_hash TEXT PRIMARY KEY,
    staff_id   TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// ---- idempotent migrations (bring an already-deployed NAS db up to date) ----
// Auth tables (users/sessions) are intentionally NOT created here: the auth
// library chosen in Phase B owns its own schema. These columns are ours —
// backend-agnostic, populated by the auth/push layers later. Table names are
// hardcoded literals (no user input), so the interpolation is injection-safe.
function tableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}
function addColumn(table: string, column: string, ddl: string): void {
  if (!tableColumns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('orders', 'user_id', 'user_id TEXT'); // nullable → anonymous orders stay valid
addColumn('subscriptions', 'transport', "transport TEXT NOT NULL DEFAULT 'webpush'");
addColumn('subscriptions', 'platform', "platform TEXT NOT NULL DEFAULT 'web'");

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
const stOrderDeviceId = db.prepare(`SELECT device_id FROM orders WHERE id = ?`);

export function createOrder(input: {
  name: string;
  items: OrderItem[];
  note: string;
  deviceId?: string;
}): Order {
  const count = (stCountOrders.get() as { n: number }).n;
  if (count >= LIMITS.maxOrders) {
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

/** The anonymous device that placed an order, for routing "your drink" pushes. */
export function orderDeviceId(id: string): string | null {
  const row = stOrderDeviceId.get(id) as { device_id: string | null } | undefined;
  return row?.device_id ?? null;
}

// ---- subscriptions (Phase 3 plumbing, present now so the schema is stable) --

const stUpsertSub = db.prepare(
  `INSERT INTO subscriptions (device_id, role, subscription, endpoint, transport, platform, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(device_id, endpoint) DO UPDATE SET
     role = excluded.role,
     subscription = excluded.subscription,
     transport = excluded.transport,
     platform = excluded.platform`,
);
const stSubsByDevice = db.prepare(`SELECT * FROM subscriptions WHERE device_id = ?`);
const stSubsByRole = db.prepare(`SELECT * FROM subscriptions WHERE role = ?`);
const stDeleteSub = db.prepare(`DELETE FROM subscriptions WHERE device_id = ? AND endpoint = ?`);

interface SubRow {
  device_id: string;
  role: string;
  subscription: string;
  endpoint: string;
  transport: string;
  platform: string;
  created_at: number;
}

function rowToSub(r: SubRow): SubscriptionRecord {
  return {
    deviceId: r.device_id,
    role: r.role as SubscriberRole,
    subscription: JSON.parse(r.subscription) as PushSubscriptionJSON,
    transport: r.transport as SubscriptionTransport,
    platform: r.platform as Platform,
    createdAt: r.created_at,
  };
}

export function saveSubscription(
  deviceId: string,
  role: SubscriberRole,
  subscription: PushSubscriptionJSON,
  transport: SubscriptionTransport = 'webpush',
  platform: Platform = 'web',
): void {
  stUpsertSub.run(
    deviceId,
    role,
    JSON.stringify(subscription),
    subscription.endpoint,
    transport,
    platform,
    now(),
  );
}

export function subscriptionsForDevice(deviceId: string): SubscriptionRecord[] {
  return (stSubsByDevice.all(deviceId) as unknown as SubRow[]).map(rowToSub);
}

export function subscriptionsForRole(role: SubscriberRole): SubscriptionRecord[] {
  return (stSubsByRole.all(role) as unknown as SubRow[]).map(rowToSub);
}

/** Remove a dead subscription (called when a push returns 404/410 Gone). */
export function deleteSubscription(deviceId: string, endpoint: string): void {
  stDeleteSub.run(deviceId, endpoint);
}

// ---- staff auth (email + password, server-side bearer sessions) ------------

const stInsertStaff = db.prepare(
  `INSERT INTO staff (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
);
const stStaffByEmail = db.prepare(`SELECT * FROM staff WHERE email = ?`);
const stStaffById = db.prepare(`SELECT * FROM staff WHERE id = ?`);
const stUpdateStaffPw = db.prepare(`UPDATE staff SET password_hash = ? WHERE id = ?`);
const stInsertSession = db.prepare(
  `INSERT INTO staff_sessions (token_hash, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
);
const stSessionByHash = db.prepare(`SELECT * FROM staff_sessions WHERE token_hash = ?`);
const stDeleteSession = db.prepare(`DELETE FROM staff_sessions WHERE token_hash = ?`);
const stPurgeSessions = db.prepare(`DELETE FROM staff_sessions WHERE expires_at < ?`);

export interface StaffRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: number;
}
interface SessionRow {
  token_hash: string;
  staff_id: string;
  expires_at: number;
  created_at: number;
}

export const staffByEmail = (email: string): StaffRow | null =>
  (stStaffByEmail.get(email) as StaffRow | undefined) ?? null;
export const staffById = (id: string): StaffRow | null =>
  (stStaffById.get(id) as StaffRow | undefined) ?? null;

export function createStaff(s: {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
}): void {
  stInsertStaff.run(s.id, s.email, s.passwordHash, s.role, now());
}
export function updateStaffPassword(id: string, passwordHash: string): void {
  stUpdateStaffPw.run(passwordHash, id);
}
export function createStaffSession(tokenHash: string, staffId: string, expiresAt: number): void {
  stInsertSession.run(tokenHash, staffId, expiresAt, now());
}
export const staffSession = (tokenHash: string): SessionRow | null =>
  (stSessionByHash.get(tokenHash) as SessionRow | undefined) ?? null;
export const deleteStaffSession = (tokenHash: string): void => {
  stDeleteSession.run(tokenHash);
};
export const purgeExpiredSessions = (): void => {
  stPurgeSessions.run(now());
};
