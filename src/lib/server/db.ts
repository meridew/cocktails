/**
 * Persistence layer. All queries live here; callers get plain functions.
 *
 * `createDb(path)` builds an isolated handle, applies any outstanding migrations,
 * and returns the query API. The module then exposes each query as a thin delegate
 * over a lazily-created singleton, so callers (`auth.ts`, `push.ts`, `app.ts`)
 * import plain functions and know nothing about the handle. Tests call
 * `createDb(':memory:')` directly for a fresh schema per test.
 *
 * Queries are Drizzle rather than SQL strings, which buys two things worth the
 * rewrite: the row types are *derived* from `schema.ts` instead of asserted with
 * `as unknown as`, and a mistyped column is a compile error rather than a runtime
 * one. Where Drizzle can't express something (SQLite's `rowid`, boolean-expression
 * ordering, `COALESCE` in an UPDATE) the `sql` template drops through — that's the
 * intended escape hatch, not a workaround.
 *
 * Everything is synchronous: better-sqlite3 is a synchronous driver, and SQLite is
 * a library rather than a server, so there is no I/O to await.
 *
 * Lazy on purpose: importing this module must not touch the filesystem, so a
 * typecheck or a test that never queries pays nothing.
 */
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, asc, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
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
} from '$lib/shared';
import { LIMITS, isHandoff } from '$lib/shared';
import { config } from './config';
import * as schema from './schema';
import { joinCodes, orders, staff, staffSessions, subscriptions } from './schema';

export const now = (): number => Date.now();
export const genId = (): string => randomBytes(6).toString('hex');

/**
 * Row types, inferred from the schema rather than hand-written.
 *
 * This is the point of the ORM: these cannot drift from the table definitions,
 * because they *are* the table definitions. Fields are camelCase in TypeScript and
 * snake_case on disk — `schema.ts` maps between them.
 */
export type StaffRow = typeof staff.$inferSelect;
export type SessionRow = typeof staffSessions.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;

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
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    bumpedAt: r.bumpedAt,
    handoff: isHandoff(r.handoff) ? r.handoff : null,
  };
}

function rowToSub(r: SubRow): SubscriptionRecord {
  return {
    deviceId: r.deviceId,
    role: r.role as SubscriberRole,
    subscription: JSON.parse(r.subscription) as PushSubscriptionJSON,
    transport: r.transport as SubscriptionTransport,
    platform: r.platform as Platform,
    createdAt: r.createdAt,
  };
}

/**
 * Where the generated migrations live.
 *
 * Resolved from the working directory rather than from `import.meta.url`, because
 * the built server is bundled into `build/` while `drizzle/` ships beside it. The
 * env var exists so a deployment that lays things out differently can say so
 * instead of failing at boot.
 */
function migrationsDir(): string {
  return process.env.DRIZZLE_DIR ?? resolve(process.cwd(), 'drizzle');
}

/** Open (or create) a database, bring it up to the current schema, return the API. */
export function createDb(dbPath: string) {
  const sqlite = openHandle(dbPath);
  const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsDir() });

  /** One order by id, or undefined. Used after every mutation to return the truth. */
  const getRow = (id: string): OrderRow | undefined =>
    db.select().from(orders).where(eq(orders.id, id)).get();

  return {
    /** Escape hatch for tests (PRAGMA inspection). Not for application use. */
    raw: sqlite,

    /**
     * The Drizzle handle itself, for Better Auth's adapter.
     *
     * Exposed rather than given its own connection so accounts and orders share
     * one database, one WAL and one set of migrations — two handles on the same
     * SQLite file would be a writer-contention bug waiting to happen.
     */
    orm: db,

    createOrder(input: {
      name: string;
      items: OrderItem[];
      note: string;
      deviceId?: string;
    }): Order {
      const total = db.select({ n: count() }).from(orders).get()?.n ?? 0;
      if (total >= LIMITS.maxOrders) {
        // Eviction candidate: finished orders first, then the oldest. Without the
        // status term, flooding the endpoint would delete the live queue before
        // touching rows nobody cares about any more.
        const evict = db
          .select({ id: orders.id })
          .from(orders)
          .orderBy(sql`(${orders.status} = 'done') DESC`, asc(orders.createdAt), sql`rowid ASC`)
          .limit(1)
          .get();
        if (evict) db.delete(orders).where(eq(orders.id, evict.id)).run();
      }
      const ts = now();
      const id = genId();
      db.insert(orders)
        .values({
          id,
          name: input.name,
          items: JSON.stringify(input.items),
          note: input.note,
          status: 'pending',
          deviceId: input.deviceId ?? null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return rowToOrder(getRow(id)!);
    },

    /**
     * Bumped orders first (most recently bumped wins), then oldest. The client can
     * re-sort for display, but this keeps the wire order meaningful on its own.
     */
    listOrders(): Order[] {
      return db
        .select()
        .from(orders)
        .orderBy(
          sql`(${orders.bumpedAt} IS NOT NULL) DESC`,
          desc(orders.bumpedAt),
          asc(orders.createdAt),
          sql`rowid ASC`,
        )
        .all()
        .map(rowToOrder);
    },

    /**
     * Move an order along, optionally recording how it reaches the guest.
     *
     * The handoff describes the serve moment specifically, so stepping back to
     * `pending`/`making` clears it — otherwise re-serving would silently reuse the
     * previous choice and notify the guest with stale wording.
     */
    setOrderStatus(id: string, status: OrderStatus, handoff?: Handoff): Order | null {
      const existing = getRow(id);
      if (!existing) return null;
      const nextHandoff =
        handoff ?? (status === 'pending' || status === 'making' ? null : existing.handoff);
      db.update(orders)
        .set({ status, handoff: nextHandoff, updatedAt: now() })
        .where(eq(orders.id, id))
        .run();
      return rowToOrder(getRow(id)!);
    },

    /** Push an order to the front of the queue (or clear that, with null). */
    bumpOrder(id: string, bumped: boolean): Order | null {
      const res = db
        .update(orders)
        .set({ bumpedAt: bumped ? now() : null, updatedAt: now() })
        .where(eq(orders.id, id))
        .run();
      if (res.changes === 0) return null;
      return rowToOrder(getRow(id)!);
    },

    /**
     * Record how many of one line have been poured. Clamped to 0..qty here rather
     * than trusted from the client, and the item name/qty are never taken from the
     * request — only the count changes.
     */
    setItemProgress(id: string, index: number, made: number): Order | null {
      const row = getRow(id);
      if (!row) return null;
      const order = rowToOrder(row);
      const item = order.items[index];
      if (!item) return null;
      const next = order.items.map((it, i) =>
        i === index ? { ...it, made: Math.max(0, Math.min(Math.floor(made), it.qty)) } : it,
      );
      db.update(orders)
        .set({ items: JSON.stringify(next), updatedAt: now() })
        .where(eq(orders.id, id))
        .run();
      return rowToOrder(getRow(id)!);
    },

    deleteOrder(id: string): boolean {
      return db.delete(orders).where(eq(orders.id, id)).run().changes > 0;
    },

    clearOrders(which: ClearWhich): void {
      if (which === 'all') db.delete(orders).run();
      else db.delete(orders).where(eq(orders.status, 'done')).run();
    },

    /** The anonymous device that placed an order, for routing "your drink" pushes. */
    orderDeviceId(id: string): string | null {
      return (
        db.select({ deviceId: orders.deviceId }).from(orders).where(eq(orders.id, id)).get()
          ?.deviceId ?? null
      );
    },

    saveSubscription(
      deviceId: string,
      role: SubscriberRole,
      subscription: PushSubscriptionJSON,
      transport: SubscriptionTransport = 'webpush',
      platform: Platform = 'web',
    ): void {
      db.insert(subscriptions)
        .values({
          deviceId,
          role,
          subscription: JSON.stringify(subscription),
          endpoint: subscription.endpoint,
          transport,
          platform,
          createdAt: now(),
        })
        .onConflictDoUpdate({
          target: [subscriptions.deviceId, subscriptions.endpoint, subscriptions.role],
          set: {
            subscription: sql`excluded.subscription`,
            transport: sql`excluded.transport`,
            platform: sql`excluded.platform`,
          },
        })
        .run();
    },

    subscriptionsForDevice(deviceId: string): SubscriptionRecord[] {
      return db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.deviceId, deviceId))
        .all()
        .map(rowToSub);
    },

    subscriptionsForRole(role: SubscriberRole): SubscriptionRecord[] {
      return db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.role, role))
        .all()
        .map(rowToSub);
    },

    /** Remove a dead subscription (called when a push returns 404/410 Gone). */
    deleteSubscription(deviceId: string, endpoint: string): void {
      db.delete(subscriptions)
        .where(and(eq(subscriptions.deviceId, deviceId), eq(subscriptions.endpoint, endpoint)))
        .run();
    },

    /**
     * Forget a device entirely — every role. This is what "notifications off"
     * means: not a stored preference we later consult, but nothing left to send
     * to. (Web Push subscriptions are `userVisibleOnly`, so a push that arrives
     * must display something; suppressing it client-side would just swap our
     * notification for the browser's own "site updated in the background".)
     */
    deleteSubscriptionsForDevice(deviceId: string): void {
      db.delete(subscriptions).where(eq(subscriptions.deviceId, deviceId)).run();
    },

    /** Record a join code (hashed) that the host can read out to a helper. */
    createJoinCode(codeHash: string, expiresAt: number, createdBy: string): void {
      // Opportunistic sweep, so the table stays tiny.
      db.delete(joinCodes).where(lt(joinCodes.expiresAt, now())).run();
      db.insert(joinCodes).values({ codeHash, expiresAt, createdBy, createdAt: now() }).run();
    },

    /** A join code, only if it exists and hasn't expired. */
    liveJoinCode(codeHash: string): { expiresAt: number } | null {
      const row = db.select().from(joinCodes).where(eq(joinCodes.codeHash, codeHash)).get();
      if (!row || row.expiresAt < now()) return null;
      return { expiresAt: row.expiresAt };
    },

    /** Invalidate every outstanding code — the host's "stop letting people in". */
    clearJoinCodes(): void {
      db.delete(joinCodes).run();
    },

    staffByEmail(email: string): StaffRow | null {
      return db.select().from(staff).where(eq(staff.email, email)).get() ?? null;
    },

    staffById(id: string): StaffRow | null {
      return db.select().from(staff).where(eq(staff.id, id)).get() ?? null;
    },

    /** Look up the pending request a device already has, so it can't queue several. */
    pendingStaffForDevice(deviceId: string): StaffRow | null {
      return (
        db
          .select()
          .from(staff)
          .where(and(eq(staff.deviceId, deviceId), eq(staff.status, 'pending')))
          .get() ?? null
      );
    },

    /**
     * Whatever staff row this device already has, in any status — an admin first,
     * so the host's own phone is never mistaken for a helper it also has a row for.
     */
    staffForDevice(deviceId: string): StaffRow | null {
      return (
        db
          .select()
          .from(staff)
          .where(eq(staff.deviceId, deviceId))
          .orderBy(
            sql`(${staff.role} = 'admin') DESC`,
            sql`(${staff.status} = 'active') DESC`,
            sql`rowid DESC`,
          )
          .get() ?? null
      );
    },

    /** Update the display name — the only thing a helper can change about themselves. */
    renameStaff(id: string, displayName: string): void {
      db.update(staff).set({ displayName }).where(eq(staff.id, id)).run();
    },

    staffByClaim(claimHash: string): StaffRow | null {
      return db.select().from(staff).where(eq(staff.claimHash, claimHash)).get() ?? null;
    },

    /** Pending first (that's what needs action), then newest. */
    listStaff(): StaffRow[] {
      return db
        .select()
        .from(staff)
        .orderBy(sql`(${staff.status} = 'pending') DESC`, desc(staff.createdAt), sql`rowid DESC`)
        .all();
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
      /** Defaults to 'request' — the slow path, where an admin decides. */
      joinedVia?: 'seed' | 'code' | 'request';
    }): void {
      db.insert(staff)
        .values({
          id: s.id,
          displayName: s.displayName,
          email: s.email ?? null,
          passwordHash: s.passwordHash ?? null,
          deviceId: s.deviceId ?? null,
          role: s.role,
          status: s.status,
          claimHash: s.claimHash ?? null,
          claimExpiresAt: s.claimExpiresAt ?? null,
          joinedVia: s.joinedVia ?? 'request',
          createdAt: now(),
        })
        .run();
    },

    /** Record how someone got in, when it changes (e.g. asked, then used a code). */
    setJoinedVia(id: string, joinedVia: 'seed' | 'code' | 'request'): void {
      db.update(staff).set({ joinedVia }).where(eq(staff.id, id)).run();
    },

    updateStaffPassword(id: string, passwordHash: string): void {
      db.update(staff).set({ passwordHash }).where(eq(staff.id, id)).run();
    },

    /** Promote the env-configured account so an admin can never be locked out. */
    ensureAdmin(id: string): void {
      db.update(staff).set({ role: 'admin', status: 'active' }).where(eq(staff.id, id)).run();
    },

    setStaffStatus(id: string, status: string, approvedBy: string | null = null): void {
      db.update(staff)
        // COALESCE so passing null leaves the existing approver alone: a later
        // status change must not erase who originally decided.
        .set({ status, approvedBy: sql`COALESCE(${approvedBy}, ${staff.approvedBy})` })
        .where(eq(staff.id, id))
        .run();
    },

    /** Consume a claim secret so an approval can only be collected once. */
    clearStaffClaim(id: string): void {
      db.update(staff).set({ claimHash: null, claimExpiresAt: null }).where(eq(staff.id, id)).run();
    },

    /** Re-issue a claim secret (asking again from the same device). */
    setStaffClaim(id: string, claimHash: string, expiresAt: number): void {
      db.update(staff).set({ claimHash, claimExpiresAt: expiresAt }).where(eq(staff.id, id)).run();
    },

    deleteStaff(id: string): void {
      db.delete(staff).where(eq(staff.id, id)).run();
      db.delete(staffSessions).where(eq(staffSessions.staffId, id)).run();
    },

    /** End the party: revoke every helper and kill their sessions. Admins survive. */
    revokeAllHelpers(): void {
      db.update(staff)
        .set({ status: 'revoked' })
        .where(and(ne(staff.role, 'admin'), eq(staff.status, 'active')))
        .run();
      db.delete(staffSessions)
        .where(
          inArray(
            staffSessions.staffId,
            db.select({ id: staff.id }).from(staff).where(ne(staff.role, 'admin')),
          ),
        )
        .run();
    },

    /** Revocation must be immediate, so drop the sessions too. */
    revokeStaff(id: string): void {
      db.update(staff).set({ status: 'revoked' }).where(eq(staff.id, id)).run();
      db.delete(staffSessions).where(eq(staffSessions.staffId, id)).run();
    },

    /** Drop abandoned requests whose claim window has passed. */
    purgeStalePendingStaff(): void {
      db.delete(staff)
        .where(and(eq(staff.status, 'pending'), lt(staff.claimExpiresAt, now())))
        .run();
    },

    createStaffSession(tokenHash: string, staffId: string, expiresAt: number): void {
      db.insert(staffSessions).values({ tokenHash, staffId, expiresAt, createdAt: now() }).run();
    },

    staffSession(tokenHash: string): SessionRow | null {
      return (
        db.select().from(staffSessions).where(eq(staffSessions.tokenHash, tokenHash)).get() ?? null
      );
    },

    deleteStaffSession(tokenHash: string): void {
      db.delete(staffSessions).where(eq(staffSessions.tokenHash, tokenHash)).run();
    },

    purgeExpiredSessions(): void {
      db.delete(staffSessions).where(lt(staffSessions.expiresAt, now())).run();
    },
  };
}

export type Db = ReturnType<typeof createDb>;

/** `:memory:` is a magic token, not a path — resolving it would create a real file. */
function openHandle(dbPath: string): Database.Database {
  if (dbPath === ':memory:') return new Database(':memory:');
  const file = resolve(process.cwd(), dbPath);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000'); // wait rather than fail if another process writes
  return db;
}

// ---- module-level singleton + delegates ------------------------------------
// Callers import these plain functions; the handle is created on first query.

let singleton: Db | undefined;
const d = (): Db => (singleton ??= createDb(config.dbPath));

/** The shared Drizzle handle, for Better Auth's adapter. See `accounts.ts`. */
export const orm = (): Db['orm'] => d().orm;

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
export const createStaff: Db['createStaff'] = (s) => d().createStaff(s);
export const setJoinedVia: Db['setJoinedVia'] = (id, via) => d().setJoinedVia(id, via);
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
