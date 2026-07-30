/**
 * Persistence layer. All SQL lives here; callers get plain functions.
 *
 * `createDb(path)` builds an isolated database handle with its statements
 * prepared once. The module then exposes each query as a thin delegate over a
 * lazily-created singleton, so callers (`auth.ts`, `push.ts`, `app.ts`) import
 * plain functions and know nothing about the handle. Tests call `createDb(':memory:')`
 * directly for a fresh schema per test, and can open a pre-seeded file to
 * exercise the migrations.
 *
 * Lazy on purpose: importing this module must not touch the filesystem, so a
 * typecheck or a test that never queries pays nothing.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ClearWhich,
  Handoff,
  Order,
  OrderItem,
  OrderStatus,
  Platform,
  PushSubscriptionJSON,
  SubscriberRole,
  SubscriptionRecord,
  SubscriptionTransport,
} from '@cocktails/shared';
import { LIMITS, isHandoff } from '@cocktails/shared';
import { config } from './config.ts';

export const now = (): number => Date.now();
export const genId = (): string => randomBytes(6).toString('hex');

interface OrderRow {
  id: string;
  name: string;
  items: string;
  note: string;
  status: string;
  device_id: string | null;
  bumped_at: number | null;
  handoff: string | null;
  created_at: number;
  updated_at: number;
}

export interface StaffRow {
  id: string;
  display_name: string;
  /** null for helpers (they have no password to sign in with) */
  email: string | null;
  password_hash: string | null;
  device_id: string | null;
  role: string;
  status: string;
  claim_hash: string | null;
  claim_expires_at: number | null;
  approved_by: string | null;
  created_at: number;
}

interface SessionRow {
  token_hash: string;
  staff_id: string;
  expires_at: number;
  created_at: number;
}

interface SubRow {
  device_id: string;
  role: string;
  subscription: string;
  endpoint: string;
  transport: string;
  platform: string;
  created_at: number;
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
    bumpedAt: r.bumped_at,
    handoff: isHandoff(r.handoff) ? r.handoff : null,
  };
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

/** Open (or create) a database, apply the schema + migrations, prepare statements. */
export function createDb(dbPath: string) {
  const db = openHandle(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      items      TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'pending',
      device_id  TEXT,
      user_id    TEXT,
      bumped_at  INTEGER,
      handoff    TEXT,
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
      -- role is part of the key: one device legitimately holds BOTH roles (the
      -- host runs the bar and orders drinks). With (device_id, endpoint) alone,
      -- registering one role overwrote the other and silently killed its pushes.
      PRIMARY KEY (device_id, endpoint, role)
    );
    -- email and password_hash are NULLABLE on purpose: an approved helper has
    -- neither (their identity is a device, their credential is a session), while
    -- an admin has both so they can sign in from any device. SQLite allows many
    -- NULLs under a UNIQUE index, so several helpers can coexist without emails.
    CREATE TABLE IF NOT EXISTS staff (
      id                TEXT PRIMARY KEY,
      display_name      TEXT NOT NULL DEFAULT '',
      email             TEXT UNIQUE,
      password_hash     TEXT,
      device_id         TEXT,
      role              TEXT NOT NULL DEFAULT 'bartender',
      status            TEXT NOT NULL DEFAULT 'active',
      claim_hash        TEXT,
      claim_expires_at  INTEGER,
      approved_by       TEXT,
      created_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_sessions (
      token_hash TEXT PRIMARY KEY,
      staff_id   TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- Short-lived codes the host reads out to onboard a helper on the spot. Only
    -- the SHA-256 is stored: a stolen database shouldn't hand anyone the bar.
    -- Reusable until they expire, because one code often onboards several people.
    CREATE TABLE IF NOT EXISTS join_codes (
      code_hash  TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // ---- idempotent migrations (bring an already-deployed NAS db up to date) ----
  // Additive only: each column is added once, so re-running is a no-op. Table and
  // column names are hardcoded literals (never user input), so the interpolation
  // is injection-safe.
  const tableColumns = (table: string): Set<string> => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  };
  const addColumn = (table: string, column: string, ddl: string): void => {
    if (!tableColumns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn('orders', 'user_id', 'user_id TEXT'); // nullable → anonymous orders stay valid
  addColumn('orders', 'bumped_at', 'bumped_at INTEGER'); // null = never bumped
  addColumn('orders', 'handoff', 'handoff TEXT'); // null = the bar didn't say
  addColumn('subscriptions', 'transport', "transport TEXT NOT NULL DEFAULT 'webpush'");
  addColumn('subscriptions', 'platform', "platform TEXT NOT NULL DEFAULT 'web'");
  addColumn('staff', 'display_name', "display_name TEXT NOT NULL DEFAULT ''");
  addColumn('staff', 'device_id', 'device_id TEXT');
  addColumn('staff', 'status', "status TEXT NOT NULL DEFAULT 'active'");
  addColumn('staff', 'claim_hash', 'claim_hash TEXT');
  addColumn('staff', 'claim_expires_at', 'claim_expires_at INTEGER');
  addColumn('staff', 'approved_by', 'approved_by TEXT');

  /**
   * Widen the subscriptions primary key to include `role`.
   *
   * SQLite can't ALTER a primary key, so this rebuilds the table — but only when
   * the old key is still in place, which keeps it idempotent in the same
   * detect-then-act style as addColumn. Runs after the column migrations above so
   * transport/platform are guaranteed to exist by the time we copy.
   */
  const primaryKeyColumns = (table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[])
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name);

  if (!primaryKeyColumns('subscriptions').includes('role')) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE subscriptions_migrated (
        device_id    TEXT NOT NULL,
        role         TEXT NOT NULL,
        subscription TEXT NOT NULL,
        endpoint     TEXT NOT NULL,
        transport    TEXT NOT NULL DEFAULT 'webpush',
        platform     TEXT NOT NULL DEFAULT 'web',
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (device_id, endpoint, role)
      );
      INSERT INTO subscriptions_migrated
        (device_id, role, subscription, endpoint, transport, platform, created_at)
        SELECT device_id, role, subscription, endpoint, transport, platform, created_at
        FROM subscriptions;
      DROP TABLE subscriptions;
      ALTER TABLE subscriptions_migrated RENAME TO subscriptions;
      COMMIT;
    `);
  }

  /**
   * Relax `staff.email` / `staff.password_hash` to nullable.
   *
   * An approved helper has neither — their identity is a device and their
   * credential is a session. SQLite can't drop a NOT NULL constraint, so this
   * rebuilds the table, guarded on the constraint still being present so it stays
   * idempotent. Runs after addColumn above, so the new columns exist to copy.
   */
  const isNotNull = (table: string, column: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[]).some(
      (r) => r.name === column && r.notnull === 1,
    );

  if (isNotNull('staff', 'email')) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE staff_migrated (
        id                TEXT PRIMARY KEY,
        display_name      TEXT NOT NULL DEFAULT '',
        email             TEXT UNIQUE,
        password_hash     TEXT,
        device_id         TEXT,
        role              TEXT NOT NULL DEFAULT 'bartender',
        status            TEXT NOT NULL DEFAULT 'active',
        claim_hash        TEXT,
        claim_expires_at  INTEGER,
        approved_by       TEXT,
        created_at        INTEGER NOT NULL
      );
      INSERT INTO staff_migrated
        (id, display_name, email, password_hash, device_id, role, status,
         claim_hash, claim_expires_at, approved_by, created_at)
        SELECT id, display_name, email, password_hash, device_id, role, status,
               claim_hash, claim_expires_at, approved_by, created_at
        FROM staff;
      DROP TABLE staff;
      ALTER TABLE staff_migrated RENAME TO staff;
      COMMIT;
    `);
  }

  // Existing rows predate display_name; fall back to the email's local part so the
  // admin list is readable rather than showing a blank name.
  db.exec(`
    UPDATE staff
       SET display_name = COALESCE(NULLIF(substr(email, 1, instr(email, '@') - 1), ''), 'Staff')
     WHERE display_name = ''
  `);

  // ---- orders ----
  const stInsertOrder = db.prepare(
    `INSERT INTO orders (id, name, items, note, status, device_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
  );
  // Bumped orders come first (most recently bumped wins), then oldest. The client
  // can re-sort for display, but this keeps the wire order meaningful on its own.
  const stListOrders = db.prepare(
    `SELECT * FROM orders
      ORDER BY (bumped_at IS NOT NULL) DESC, bumped_at DESC, created_at ASC, rowid ASC`,
  );
  const stGetOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`);
  const stCountOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders`);
  // Eviction candidate: finished orders first, then the oldest. Without the status
  // term, flooding the endpoint would delete the live queue before touching rows
  // nobody cares about any more.
  const stEvictionCandidate = db.prepare(
    `SELECT id FROM orders
     ORDER BY (status = 'done') DESC, created_at ASC, rowid ASC
     LIMIT 1`,
  );
  const stSetStatus = db.prepare(
    `UPDATE orders SET status = ?, handoff = ?, updated_at = ? WHERE id = ?`,
  );
  const stBumpOrder = db.prepare(`UPDATE orders SET bumped_at = ?, updated_at = ? WHERE id = ?`);
  const stSetItems = db.prepare(`UPDATE orders SET items = ?, updated_at = ? WHERE id = ?`);
  const stDeleteOrder = db.prepare(`DELETE FROM orders WHERE id = ?`);
  const stClearDone = db.prepare(`DELETE FROM orders WHERE status = 'done'`);
  const stClearAll = db.prepare(`DELETE FROM orders`);
  const stOrderDeviceId = db.prepare(`SELECT device_id FROM orders WHERE id = ?`);

  // ---- subscriptions ----
  const stUpsertSub = db.prepare(
    `INSERT INTO subscriptions (device_id, role, subscription, endpoint, transport, platform, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, endpoint, role) DO UPDATE SET
       subscription = excluded.subscription,
       transport = excluded.transport,
       platform = excluded.platform`,
  );
  const stSubsByDevice = db.prepare(`SELECT * FROM subscriptions WHERE device_id = ?`);
  const stSubsByRole = db.prepare(`SELECT * FROM subscriptions WHERE role = ?`);
  const stDeleteSub = db.prepare(`DELETE FROM subscriptions WHERE device_id = ? AND endpoint = ?`);
  const stDeleteSubsForDevice = db.prepare(`DELETE FROM subscriptions WHERE device_id = ?`);

  // ---- join codes ----
  const stInsertJoinCode = db.prepare(
    `INSERT INTO join_codes (code_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?)`,
  );
  const stJoinCode = db.prepare(`SELECT * FROM join_codes WHERE code_hash = ?`);
  const stPurgeJoinCodes = db.prepare(`DELETE FROM join_codes WHERE expires_at < ?`);
  const stClearJoinCodes = db.prepare(`DELETE FROM join_codes`);

  // ---- staff ----
  const stInsertStaff = db.prepare(
    `INSERT INTO staff
       (id, display_name, email, password_hash, device_id, role, status,
        claim_hash, claim_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stStaffByEmail = db.prepare(`SELECT * FROM staff WHERE email = ?`);
  const stStaffById = db.prepare(`SELECT * FROM staff WHERE id = ?`);
  const stStaffByClaim = db.prepare(`SELECT * FROM staff WHERE claim_hash = ?`);
  const stStaffPendingDevice = db.prepare(
    `SELECT * FROM staff WHERE device_id = ? AND status = 'pending'`,
  );
  // Any row for this device, whatever its status — an admin first, so the host's
  // own phone is never mistaken for a helper it also happens to have a row for.
  const stStaffAnyDevice = db.prepare(
    `SELECT * FROM staff WHERE device_id = ?
      ORDER BY (role = 'admin') DESC, (status = 'active') DESC, rowid DESC`,
  );
  const stRenameStaff = db.prepare(`UPDATE staff SET display_name = ? WHERE id = ?`);
  const stListStaff = db.prepare(
    // Pending first (that's what needs action), then newest.
    `SELECT * FROM staff
      ORDER BY (status = 'pending') DESC, created_at DESC, rowid DESC`,
  );
  const stCountPending = db.prepare(`SELECT COUNT(*) AS n FROM staff WHERE status = 'pending'`);
  const stUpdateStaffPw = db.prepare(`UPDATE staff SET password_hash = ? WHERE id = ?`);
  const stSetStaffStatus = db.prepare(
    `UPDATE staff SET status = ?, approved_by = COALESCE(?, approved_by) WHERE id = ?`,
  );
  const stEnsureAdmin = db.prepare(
    `UPDATE staff SET role = 'admin', status = 'active' WHERE id = ?`,
  );
  const stClearClaim = db.prepare(
    `UPDATE staff SET claim_hash = NULL, claim_expires_at = NULL WHERE id = ?`,
  );
  const stSetClaim = db.prepare(
    `UPDATE staff SET claim_hash = ?, claim_expires_at = ? WHERE id = ?`,
  );
  const stDeleteStaff = db.prepare(`DELETE FROM staff WHERE id = ?`);
  const stRevokeHelpers = db.prepare(
    `UPDATE staff SET status = 'revoked' WHERE role <> 'admin' AND status = 'active'`,
  );
  const stDeleteSessionsFor = db.prepare(`DELETE FROM staff_sessions WHERE staff_id = ?`);
  const stDeleteHelperSessions = db.prepare(
    `DELETE FROM staff_sessions WHERE staff_id IN (SELECT id FROM staff WHERE role <> 'admin')`,
  );
  const stInsertSession = db.prepare(
    `INSERT INTO staff_sessions (token_hash, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
  );
  const stSessionByHash = db.prepare(`SELECT * FROM staff_sessions WHERE token_hash = ?`);
  const stDeleteSession = db.prepare(`DELETE FROM staff_sessions WHERE token_hash = ?`);
  const stPurgeSessions = db.prepare(`DELETE FROM staff_sessions WHERE expires_at < ?`);
  const stPurgeStalePending = db.prepare(
    `DELETE FROM staff WHERE status = 'pending' AND claim_expires_at < ?`,
  );

  return {
    /** Escape hatch for tests (PRAGMA inspection). Not for application use. */
    raw: db,

    createOrder(input: {
      name: string;
      items: OrderItem[];
      note: string;
      deviceId?: string;
    }): Order {
      const count = (stCountOrders.get() as { n: number }).n;
      if (count >= LIMITS.maxOrders) {
        const evict = stEvictionCandidate.get() as { id: string } | undefined;
        if (evict) stDeleteOrder.run(evict.id);
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
    },

    listOrders(): Order[] {
      return (stListOrders.all() as unknown as OrderRow[]).map(rowToOrder);
    },

    /**
     * Move an order along, optionally recording how it reaches the guest.
     *
     * The handoff describes the serve moment specifically, so stepping back to
     * `pending`/`making` clears it — otherwise re-serving would silently reuse the
     * previous choice and notify the guest with stale wording.
     */
    setOrderStatus(id: string, status: OrderStatus, handoff?: Handoff): Order | null {
      const existing = stGetOrder.get(id) as unknown as OrderRow | undefined;
      if (!existing) return null;
      const nextHandoff =
        handoff ?? (status === 'pending' || status === 'making' ? null : existing.handoff);
      stSetStatus.run(status, nextHandoff, now(), id);
      return rowToOrder(stGetOrder.get(id) as unknown as OrderRow);
    },

    /** Push an order to the front of the queue (or clear that, with null). */
    bumpOrder(id: string, bumped: boolean): Order | null {
      const res = stBumpOrder.run(bumped ? now() : null, now(), id);
      if (res.changes === 0) return null;
      return rowToOrder(stGetOrder.get(id) as unknown as OrderRow);
    },

    /**
     * Record how many of one line have been poured. Clamped to 0..qty here rather
     * than trusted from the client, and the item name/qty are never taken from the
     * request — only the count changes.
     */
    setItemProgress(id: string, index: number, made: number): Order | null {
      const row = stGetOrder.get(id) as unknown as OrderRow | undefined;
      if (!row) return null;
      const order = rowToOrder(row);
      const item = order.items[index];
      if (!item) return null;
      const next = order.items.map((it, i) =>
        i === index ? { ...it, made: Math.max(0, Math.min(Math.floor(made), it.qty)) } : it,
      );
      stSetItems.run(JSON.stringify(next), now(), id);
      return rowToOrder(stGetOrder.get(id) as unknown as OrderRow);
    },

    deleteOrder(id: string): boolean {
      return stDeleteOrder.run(id).changes > 0;
    },

    clearOrders(which: ClearWhich): void {
      if (which === 'all') stClearAll.run();
      else stClearDone.run();
    },

    /** The anonymous device that placed an order, for routing "your drink" pushes. */
    orderDeviceId(id: string): string | null {
      const row = stOrderDeviceId.get(id) as { device_id: string | null } | undefined;
      return row?.device_id ?? null;
    },

    saveSubscription(
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
    },

    subscriptionsForDevice(deviceId: string): SubscriptionRecord[] {
      return (stSubsByDevice.all(deviceId) as unknown as SubRow[]).map(rowToSub);
    },

    subscriptionsForRole(role: SubscriberRole): SubscriptionRecord[] {
      return (stSubsByRole.all(role) as unknown as SubRow[]).map(rowToSub);
    },

    /** Remove a dead subscription (called when a push returns 404/410 Gone). */
    deleteSubscription(deviceId: string, endpoint: string): void {
      stDeleteSub.run(deviceId, endpoint);
    },

    /**
     * Forget a device entirely — every role. This is what "notifications off"
     * means: not a stored preference we later consult, but nothing left to send
     * to. (Web Push subscriptions are `userVisibleOnly`, so a push that arrives
     * must display something; suppressing it client-side would just swap our
     * notification for the browser's own "site updated in the background".)
     */
    deleteSubscriptionsForDevice(deviceId: string): void {
      stDeleteSubsForDevice.run(deviceId);
    },

    /** Record a join code (hashed) that the host can read out to a helper. */
    createJoinCode(codeHash: string, expiresAt: number, createdBy: string): void {
      stPurgeJoinCodes.run(now()); // opportunistic sweep, so the table stays tiny
      stInsertJoinCode.run(codeHash, expiresAt, createdBy, now());
    },

    /** A join code, only if it exists and hasn't expired. */
    liveJoinCode(codeHash: string): { expiresAt: number } | null {
      const row = stJoinCode.get(codeHash) as { code_hash: string; expires_at: number } | undefined;
      if (!row || row.expires_at < now()) return null;
      return { expiresAt: row.expires_at };
    },

    /** Invalidate every outstanding code — the host's "stop letting people in". */
    clearJoinCodes(): void {
      stClearJoinCodes.run();
    },

    staffByEmail(email: string): StaffRow | null {
      return (stStaffByEmail.get(email) as StaffRow | undefined) ?? null;
    },

    staffById(id: string): StaffRow | null {
      return (stStaffById.get(id) as StaffRow | undefined) ?? null;
    },

    /** Look up the pending request a device already has, so it can't queue several. */
    pendingStaffForDevice(deviceId: string): StaffRow | null {
      return (stStaffPendingDevice.get(deviceId) as StaffRow | undefined) ?? null;
    },

    /** Whatever staff row this device already has, in any status. */
    staffForDevice(deviceId: string): StaffRow | null {
      return (stStaffAnyDevice.get(deviceId) as StaffRow | undefined) ?? null;
    },

    /** Update the display name — the only thing a helper can change about themselves. */
    renameStaff(id: string, displayName: string): void {
      stRenameStaff.run(displayName, id);
    },

    staffByClaim(claimHash: string): StaffRow | null {
      return (stStaffByClaim.get(claimHash) as StaffRow | undefined) ?? null;
    },

    listStaff(): StaffRow[] {
      return stListStaff.all() as unknown as StaffRow[];
    },

    countPendingStaff(): number {
      return (stCountPending.get() as { n: number }).n;
    },

    createStaff(s: {
      id: string;
      displayName: string;
      email?: string | null;
      passwordHash?: string | null;
      deviceId?: string | null;
      role: string;
      status: string;
      claimHash?: string | null;
      claimExpiresAt?: number | null;
    }): void {
      stInsertStaff.run(
        s.id,
        s.displayName,
        s.email ?? null,
        s.passwordHash ?? null,
        s.deviceId ?? null,
        s.role,
        s.status,
        s.claimHash ?? null,
        s.claimExpiresAt ?? null,
        now(),
      );
    },

    updateStaffPassword(id: string, passwordHash: string): void {
      stUpdateStaffPw.run(passwordHash, id);
    },

    /** Promote the env-configured account so an admin can never be locked out. */
    ensureAdmin(id: string): void {
      stEnsureAdmin.run(id);
    },

    setStaffStatus(id: string, status: string, approvedBy: string | null = null): void {
      stSetStaffStatus.run(status, approvedBy, id);
    },

    /** Consume a claim secret so an approval can only be collected once. */
    clearStaffClaim(id: string): void {
      stClearClaim.run(id);
    },

    /** Re-issue a claim secret (asking again from the same device). */
    setStaffClaim(id: string, claimHash: string, expiresAt: number): void {
      stSetClaim.run(claimHash, expiresAt, id);
    },

    deleteStaff(id: string): void {
      stDeleteStaff.run(id);
      stDeleteSessionsFor.run(id);
    },

    /** End the party: revoke every helper and kill their sessions. Admins survive. */
    revokeAllHelpers(): void {
      stRevokeHelpers.run();
      stDeleteHelperSessions.run();
    },

    /** Revocation must be immediate, so drop the sessions too. */
    revokeStaff(id: string): void {
      stSetStaffStatus.run('revoked', null, id);
      stDeleteSessionsFor.run(id);
    },

    /** Drop abandoned requests whose claim window has passed. */
    purgeStalePendingStaff(): void {
      stPurgeStalePending.run(now());
    },

    createStaffSession(tokenHash: string, staffId: string, expiresAt: number): void {
      stInsertSession.run(tokenHash, staffId, expiresAt, now());
    },

    staffSession(tokenHash: string): SessionRow | null {
      return (stSessionByHash.get(tokenHash) as SessionRow | undefined) ?? null;
    },

    deleteStaffSession(tokenHash: string): void {
      stDeleteSession.run(tokenHash);
    },

    purgeExpiredSessions(): void {
      stPurgeSessions.run(now());
    },
  };
}

export type Db = ReturnType<typeof createDb>;

/** `:memory:` is a magic token, not a path — resolving it would create a real file. */
function openHandle(dbPath: string): DatabaseSync {
  if (dbPath === ':memory:') return new DatabaseSync(':memory:');
  const file = resolve(process.cwd(), dbPath);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;'); // wait rather than fail if another process writes
  return db;
}

// ---- module-level singleton + delegates ------------------------------------
// Callers import these plain functions; the handle is created on first query.

let singleton: Db | undefined;
const d = (): Db => (singleton ??= createDb(config.dbPath));

export const createOrder: Db['createOrder'] = (input) => d().createOrder(input);
export const listOrders: Db['listOrders'] = () => d().listOrders();
export const setOrderStatus: Db['setOrderStatus'] = (id, status, handoff) =>
  d().setOrderStatus(id, status, handoff);
export const bumpOrder: Db['bumpOrder'] = (id, bumped) => d().bumpOrder(id, bumped);
export const setItemProgress: Db['setItemProgress'] = (id, index, made) =>
  d().setItemProgress(id, index, made);
export const deleteOrder: Db['deleteOrder'] = (id) => d().deleteOrder(id);
export const clearOrders: Db['clearOrders'] = (which) => d().clearOrders(which);
export const orderDeviceId: Db['orderDeviceId'] = (id) => d().orderDeviceId(id);

export const saveSubscription: Db['saveSubscription'] = (dev, role, sub, transport, platform) =>
  d().saveSubscription(dev, role, sub, transport, platform);
export const subscriptionsForDevice: Db['subscriptionsForDevice'] = (dev) =>
  d().subscriptionsForDevice(dev);
export const subscriptionsForRole: Db['subscriptionsForRole'] = (role) =>
  d().subscriptionsForRole(role);
export const deleteSubscription: Db['deleteSubscription'] = (dev, endpoint) =>
  d().deleteSubscription(dev, endpoint);
export const deleteSubscriptionsForDevice: Db['deleteSubscriptionsForDevice'] = (dev) =>
  d().deleteSubscriptionsForDevice(dev);
export const createJoinCode: Db['createJoinCode'] = (hash, expiresAt, by) =>
  d().createJoinCode(hash, expiresAt, by);
export const liveJoinCode: Db['liveJoinCode'] = (hash) => d().liveJoinCode(hash);
export const clearJoinCodes: Db['clearJoinCodes'] = () => d().clearJoinCodes();

export const staffByEmail: Db['staffByEmail'] = (email) => d().staffByEmail(email);
export const staffById: Db['staffById'] = (id) => d().staffById(id);
export const staffByClaim: Db['staffByClaim'] = (hash) => d().staffByClaim(hash);
export const pendingStaffForDevice: Db['pendingStaffForDevice'] = (deviceId) =>
  d().pendingStaffForDevice(deviceId);
export const staffForDevice: Db['staffForDevice'] = (deviceId) => d().staffForDevice(deviceId);
export const renameStaff: Db['renameStaff'] = (id, name) => d().renameStaff(id, name);
export const listStaff: Db['listStaff'] = () => d().listStaff();
export const countPendingStaff: Db['countPendingStaff'] = () => d().countPendingStaff();
export const createStaff: Db['createStaff'] = (s) => d().createStaff(s);
export const updateStaffPassword: Db['updateStaffPassword'] = (id, hash) =>
  d().updateStaffPassword(id, hash);
export const ensureAdmin: Db['ensureAdmin'] = (id) => d().ensureAdmin(id);
export const setStaffStatus: Db['setStaffStatus'] = (id, status, approvedBy) =>
  d().setStaffStatus(id, status, approvedBy);
export const clearStaffClaim: Db['clearStaffClaim'] = (id) => d().clearStaffClaim(id);
export const setStaffClaim: Db['setStaffClaim'] = (id, hash, expiresAt) =>
  d().setStaffClaim(id, hash, expiresAt);
export const deleteStaff: Db['deleteStaff'] = (id) => d().deleteStaff(id);
export const revokeStaff: Db['revokeStaff'] = (id) => d().revokeStaff(id);
export const revokeAllHelpers: Db['revokeAllHelpers'] = () => d().revokeAllHelpers();
export const purgeStalePendingStaff: Db['purgeStalePendingStaff'] = () =>
  d().purgeStalePendingStaff();
export const createStaffSession: Db['createStaffSession'] = (hash, staffId, expiresAt) =>
  d().createStaffSession(hash, staffId, expiresAt);
export const staffSession: Db['staffSession'] = (hash) => d().staffSession(hash);
export const deleteStaffSession: Db['deleteStaffSession'] = (hash) => d().deleteStaffSession(hash);
export const purgeExpiredSessions: Db['purgeExpiredSessions'] = () => d().purgeExpiredSessions();
