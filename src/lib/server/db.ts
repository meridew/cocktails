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
import {
  event,
  eventGuest,
  eventMenu,
  orders,
  staff,
  staffSessions,
  stock,
  subscriptions,
} from './schema';
import { user } from './schema.auth';

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
export type EventRow = typeof event.$inferSelect;
export type StockRow = typeof stock.$inferSelect;
export type UserRow = typeof user.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
export type EventGuestRow = typeof eventGuest.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;

function rowToOrder(r: OrderRow, newGuest = false, photoId: string | null = null): Order {
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
    newGuest,
    photoId,
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

  /**
   * One order by id **within an event**, or undefined.
   *
   * The event is part of the lookup rather than checked afterwards, so an id
   * belonging to another host's party simply isn't found — the same answer as an id
   * that never existed, which is also the answer that leaks least.
   */
  const getRow = (eventId: string, id: string): OrderRow | undefined =>
    db
      .select()
      .from(orders)
      .where(and(eq(orders.eventId, eventId), eq(orders.id, id)))
      .get();

  /**
   * Device ids at this party that nobody has let in — **anything but `admitted`**.
   *
   * Not `= 'pending'`, which is the obvious version and is wrong: a guest the bar
   * turned away is `blocked`, so a pending-only test would let their *next* order
   * through as ordinary. Blocking somebody would have made them harder to stop than
   * ignoring them, which is the opposite of what the button is for. Found by the
   * test that orders again after being blocked.
   *
   * A blocked guest therefore keeps arriving as a new face rather than being refused
   * outright. That is deliberate: refusing at the door is something they would
   * *notice*, and the whole design rests on the gate being imperceptible. The bar
   * sees the same name reappear and bins it again in one tap.
   *
   * One query per queue read rather than a correlated subquery per row: the list is
   * a handful of people even at a busy party, and a `Set` beats SQL for something
   * asked once and answered many times.
   *
   * **This decides a label, not visibility.** An un-admitted guest's drink sits in
   * the same queue in the same place; its card offers `Admit` where another offers
   * `Start`. The first design hid these orders instead, which made a bug in the
   * hiding indistinguishable from a guest who never ordered.
   */
  const unadmittedDevices = (eventId: string): Set<string> =>
    new Set(
      db
        .select({ deviceId: eventGuest.deviceId })
        .from(eventGuest)
        .where(and(eq(eventGuest.eventId, eventId), ne(eventGuest.status, 'admitted')))
        .all()
        .map((r) => r.deviceId),
    );

  /**
   * Which device has which face, as hashes rather than pictures.
   *
   * The hash goes out with the queue and the picture does not: the bar re-polls every
   * four seconds, and inlining even a 6KB avatar per order would be a hundred
   * kilobytes of identical bytes a minute. `Avatar.svelte` fetches each hash once.
   */
  const photoIds = (eventId: string): Map<string, string> =>
    new Map(
      db
        .select({ deviceId: eventGuest.deviceId, photoId: eventGuest.photoId })
        .from(eventGuest)
        .where(eq(eventGuest.eventId, eventId))
        .all()
        .flatMap((r) => (r.photoId ? [[r.deviceId, r.photoId] as [string, string]] : [])),
    );

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

    createOrder(
      eventId: string,
      input: { name: string; items: OrderItem[]; note: string; deviceId?: string },
    ): Order {
      // The cap is per event, so one busy party can't evict another's queue.
      const total =
        db.select({ n: count() }).from(orders).where(eq(orders.eventId, eventId)).get()?.n ?? 0;
      if (total >= LIMITS.maxOrders) {
        // Eviction candidate: finished orders first, then the oldest. Without the
        // status term, flooding the endpoint would delete the live queue before
        // touching rows nobody cares about any more.
        const evict = db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.eventId, eventId))
          .orderBy(sql`(${orders.status} = 'done') DESC`, asc(orders.createdAt), sql`rowid ASC`)
          .limit(1)
          .get();
        if (evict) db.delete(orders).where(eq(orders.id, evict.id)).run();
      }
      const ts = now();
      const id = genId();

      /**
       * A device that has never joined gets a `pending` guest row here, rather than
       * an order the gate cannot see.
       *
       * The guest screen joins first, so this is the path for anyone who didn't come
       * through it — a stale client, or somebody posting to the endpoint directly.
       * Without it, skipping the join would be a way *past* the admission gate rather
       * than into the waiting room, which is exactly backwards. `onConflictDoNothing`
       * because a returning guest already has a row and must not be reset to pending
       * on their second round.
       */
      if (input.deviceId) {
        db.insert(eventGuest)
          .values({
            eventId,
            deviceId: input.deviceId,
            name: input.name,
            status: 'pending',
            createdAt: ts,
            admittedAt: null,
          })
          .onConflictDoNothing()
          .run();
      }

      db.insert(orders)
        .values({
          id,
          eventId,
          name: input.name,
          items: JSON.stringify(input.items),
          note: input.note,
          status: 'pending',
          deviceId: input.deviceId ?? null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return rowToOrder(getRow(eventId, id)!);
    },

    // ---- who is at the party, and whether the bar has let them in ------------

    /**
     * Join, or come back. **Never demotes an admitted guest**: reopening the app
     * calls this again, and a returning regular must not land back in the waiting
     * room. The name is refreshed, because that is the one thing they might fix.
     */
    joinParty(eventId: string, deviceId: string, name: string): EventGuestRow {
      const ts = now();
      db.insert(eventGuest)
        .values({ eventId, deviceId, name, status: 'pending', createdAt: ts, admittedAt: null })
        .onConflictDoUpdate({
          target: [eventGuest.eventId, eventGuest.deviceId],
          set: { name },
        })
        .run();
      return this.guestAt(eventId, deviceId)!;
    },

    guestAt(eventId: string, deviceId: string): EventGuestRow | null {
      return (
        db
          .select()
          .from(eventGuest)
          .where(and(eq(eventGuest.eventId, eventId), eq(eventGuest.deviceId, deviceId)))
          .get() ?? null
      );
    },

    /** Everyone at this party, newest first — the bar reads the waiting ones off this. */
    listGuests(eventId: string): EventGuestRow[] {
      return db
        .select()
        .from(eventGuest)
        .where(eq(eventGuest.eventId, eventId))
        .orderBy(desc(eventGuest.createdAt))
        .all();
    },

    /**
     * Attach a face to a guest, or take it away with `(null, null)`.
     *
     * Deliberately **not** part of `joinParty`. Joining happens on every menu load,
     * and re-sending a picture that has not changed on every one of those would be
     * the whole point of hashing it thrown away. The device asks first — see
     * `guestNeedsPhoto` — and only sends when the answer is yes.
     */
    setGuestPhoto(
      eventId: string,
      deviceId: string,
      photo: string | null,
      photoId: string | null,
    ): void {
      db.update(eventGuest)
        .set({ photo, photoId })
        .where(and(eq(eventGuest.eventId, eventId), eq(eventGuest.deviceId, deviceId)))
        .run();
    },

    /**
     * One stored picture, by its content hash.
     *
     * Scoped to the party, so a hash learned at one bar cannot be replayed at
     * another — the hash is derived from the image and two people who happened to
     * upload the same picture would otherwise share a row across tenancies.
     */
    photoByHash(eventId: string, photoId: string): string | null {
      return (
        db
          .select({ photo: eventGuest.photo })
          .from(eventGuest)
          .where(and(eq(eventGuest.eventId, eventId), eq(eventGuest.photoId, photoId)))
          .get()?.photo ?? null
      );
    },

    setGuestStatus(eventId: string, deviceId: string, status: 'admitted' | 'blocked'): void {
      db.update(eventGuest)
        .set({ status, admittedAt: status === 'admitted' ? now() : null })
        .where(and(eq(eventGuest.eventId, eventId), eq(eventGuest.deviceId, deviceId)))
        .run();
    },

    /**
     * Let everyone waiting in at once, and say how many.
     *
     * A room that arrived together should not cost one tap per person while somebody
     * is trying to pour. Deliberately does **not** touch `blocked` rows — a no that
     * was said on purpose is not undone by a convenience button.
     */
    admitAllPending(eventId: string): number {
      const waiting = db
        .select({ deviceId: eventGuest.deviceId })
        .from(eventGuest)
        .where(and(eq(eventGuest.eventId, eventId), eq(eventGuest.status, 'pending')))
        .all();
      if (waiting.length === 0) return 0;
      db.update(eventGuest)
        .set({ status: 'admitted', admittedAt: now() })
        .where(and(eq(eventGuest.eventId, eventId), eq(eventGuest.status, 'pending')))
        .run();
      return waiting.length;
    },

    /**
     * Bumped orders first (most recently bumped wins), then oldest. The client can
     * re-sort for display, but this keeps the wire order meaningful on its own.
     *
     * **Everything, with the un-admitted marked rather than hidden.** A guest the
     * bar has not let in yet appears here like anyone else; their card offers
     * `Admit` where another offers `Start`, and the gate is that the drink cannot be
     * *made* until somebody does. Hiding them was the first design: it put the whole
     * feature somewhere nobody was looking, so a bug in it and a guest who never
     * ordered were the same observation.
     */
    listOrders(eventId: string): Order[] {
      const unadmitted = unadmittedDevices(eventId);
      const faces = photoIds(eventId);
      return db
        .select()
        .from(orders)
        .where(eq(orders.eventId, eventId))
        .orderBy(
          sql`(${orders.bumpedAt} IS NOT NULL) DESC`,
          desc(orders.bumpedAt),
          asc(orders.createdAt),
          sql`rowid ASC`,
        )
        .all()
        .map((r) =>
          rowToOrder(
            r,
            r.deviceId !== null && unadmitted.has(r.deviceId),
            (r.deviceId && faces.get(r.deviceId)) || null,
          ),
        );
    },

    /**
     * Move an order along, optionally recording how it reaches the guest.
     *
     * The handoff describes the serve moment specifically, so stepping back to
     * `pending`/`making` clears it — otherwise re-serving would silently reuse the
     * previous choice and notify the guest with stale wording.
     */
    setOrderStatus(
      eventId: string,
      id: string,
      status: OrderStatus,
      handoff?: Handoff,
    ): Order | null {
      const existing = getRow(eventId, id);
      if (!existing) return null;
      const nextHandoff =
        handoff ?? (status === 'pending' || status === 'making' ? null : existing.handoff);
      db.update(orders)
        .set({ status, handoff: nextHandoff, updatedAt: now() })
        .where(and(eq(orders.eventId, eventId), eq(orders.id, id)))
        .run();
      return rowToOrder(getRow(eventId, id)!);
    },

    /** Push an order to the front of the queue (or clear that, with null). */
    bumpOrder(eventId: string, id: string, bumped: boolean): Order | null {
      const res = db
        .update(orders)
        .set({ bumpedAt: bumped ? now() : null, updatedAt: now() })
        .where(and(eq(orders.eventId, eventId), eq(orders.id, id)))
        .run();
      if (res.changes === 0) return null;
      return rowToOrder(getRow(eventId, id)!);
    },

    /**
     * Record how many of one line have been poured. Clamped to 0..qty here rather
     * than trusted from the client, and the item name/qty are never taken from the
     * request — only the count changes.
     */
    setItemProgress(eventId: string, id: string, index: number, made: number): Order | null {
      const row = getRow(eventId, id);
      if (!row) return null;
      const order = rowToOrder(row);
      const item = order.items[index];
      if (!item) return null;
      const next = order.items.map((it, i) =>
        i === index ? { ...it, made: Math.max(0, Math.min(Math.floor(made), it.qty)) } : it,
      );
      db.update(orders)
        .set({ items: JSON.stringify(next), updatedAt: now() })
        .where(and(eq(orders.eventId, eventId), eq(orders.id, id)))
        .run();
      return rowToOrder(getRow(eventId, id)!);
    },

    deleteOrder(eventId: string, id: string): boolean {
      return (
        db
          .delete(orders)
          .where(and(eq(orders.eventId, eventId), eq(orders.id, id)))
          .run().changes > 0
      );
    },

    clearOrders(eventId: string, which: ClearWhich): void {
      const scope =
        which === 'all'
          ? eq(orders.eventId, eventId)
          : and(eq(orders.eventId, eventId), eq(orders.status, 'done'));
      db.delete(orders).where(scope).run();
    },

    /** The anonymous device that placed an order, for routing "your drink" pushes. */
    orderDeviceId(eventId: string, id: string): string | null {
      return getRow(eventId, id)?.deviceId ?? null;
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

    // ---- events ----

    /**
     * A party always belongs to a host. `hostUserId` is not optional any more, and
     * `liveEvent()` is gone with it — there is no such thing as "the" live party now
     * that several run at once, so a guest names theirs or doesn't order.
     */
    createEvent(e: {
      hostUserId: string;
      name: string;
      startsAt?: number | null;
      status?: string;
    }): EventRow {
      const id = genId();
      db.insert(event)
        .values({
          id,
          hostUserId: e.hostUserId,
          name: e.name,
          startsAt: e.startsAt ?? null,
          status: e.status ?? 'draft',
          createdAt: now(),
        })
        .run();
      return db.select().from(event).where(eq(event.id, id)).get()!;
    },

    eventById(id: string): EventRow | null {
      return db.select().from(event).where(eq(event.id, id)).get() ?? null;
    },

    updateEvent(
      id: string,
      changes: {
        name?: string;
        startsAt?: number | null;
        status?: string;
        /** Serialised by `writeSettings` — never a raw object. */
        settings?: string;
      },
    ): EventRow | null {
      const set: Record<string, unknown> = {};
      if (changes.name !== undefined) set.name = changes.name;
      if (changes.startsAt !== undefined) set.startsAt = changes.startsAt;
      if (changes.status !== undefined) set.status = changes.status;
      if (changes.settings !== undefined) set.settings = changes.settings;
      if (Object.keys(set).length > 0) db.update(event).set(set).where(eq(event.id, id)).run();
      return db.select().from(event).where(eq(event.id, id)).get() ?? null;
    },

    deleteEvent(id: string): void {
      db.delete(event).where(eq(event.id, id)).run();
    },

    /** Every party, newest first. Admin-only by capability, not by this function. */
    allEvents(): EventRow[] {
      return db.select().from(event).orderBy(desc(event.createdAt)).all();
    },

    /**
     * What's on tonight — the only party data anyone anonymous may read.
     *
     * `live` is the whole filter, and that is deliberate rather than lazy: opening a
     * party already means it takes orders, so making it mean "and it is on the front
     * door" adds no concept and no second thing to remember. Close it and it goes.
     */
    liveEvents(): EventRow[] {
      return db
        .select()
        .from(event)
        .where(eq(event.status, 'live'))
        .orderBy(desc(event.createdAt))
        .all();
    },

    eventsForHost(hostUserId: string): EventRow[] {
      return db
        .select()
        .from(event)
        .where(eq(event.hostUserId, hostUserId))
        .orderBy(desc(event.createdAt))
        .all();
    },

    // ---- the host's cupboard ----

    /** Everything this **host** has said something about. See `stock` in schema.ts. */
    listStock(userId: string): StockRow[] {
      return db
        .select()
        .from(stock)
        .where(eq(stock.userId, userId))
        .orderBy(asc(stock.ingredient))
        .all();
    },

    /** Upsert one ingredient for this host. Unticking writes `false`, never deletes. */
    setInStock(userId: string, ingredient: string, inStock: boolean): void {
      db.insert(stock)
        .values({ userId, ingredient, inStock })
        .onConflictDoUpdate({
          target: [stock.userId, stock.ingredient],
          set: { inStock: sql`excluded.in_stock` },
        })
        .run();
    },

    // ---- the short list ----

    /** Recipe ids this party leads with. **Empty means show everything** — see schema.ts. */
    listEventMenu(eventId: string): string[] {
      return db
        .select()
        .from(eventMenu)
        .where(eq(eventMenu.eventId, eventId))
        .all()
        .map((r) => r.recipeId);
    },

    /** Replace the short list wholesale, for the same reason the cupboard PUTs whole. */
    setEventMenu(eventId: string, recipeIds: readonly string[]): void {
      db.delete(eventMenu).where(eq(eventMenu.eventId, eventId)).run();
      if (recipeIds.length === 0) return;
      db.insert(eventMenu)
        .values(recipeIds.map((recipeId) => ({ eventId, recipeId })))
        .run();
    },

    // ---- the keypad ----

    // ---- people with accounts ----
    //
    // Better Auth owns writes to `user` for the things it manages — the name, the
    // email, the verification flag. These read it, and write only the two columns
    // that are ours: the role and the ban. Deliberately not the Better Auth admin
    // plugin; PLATFORM-PLAN §2e says why.

    userById(id: string): UserRow | null {
      return db.select().from(user).where(eq(user.id, id)).get() ?? null;
    },

    userByEmail(email: string): UserRow | null {
      return db.select().from(user).where(eq(user.email, email)).get() ?? null;
    },

    /** Everyone, newest first. The admin's list of hosts. */
    allUsers(): UserRow[] {
      return db.select().from(user).orderBy(desc(user.createdAt)).all();
    },

    setUserRole(id: string, role: 'admin' | 'host'): void {
      db.update(user).set({ role }).where(eq(user.id, id)).run();
    },

    /**
     * Suspend or reinstate. `bannedAt: null` is reinstatement, and clears the reason
     * with it — a lifted ban that kept its explanation would read as still in force.
     */
    setUserBan(id: string, bannedAt: number | null, reason: string | null): void {
      db.update(user)
        .set({ bannedAt, banReason: bannedAt === null ? null : reason })
        .where(eq(user.id, id))
        .run();
    },

    /** Cascades to their sessions, parties, cupboard and PIN by foreign key. */
    deleteUser(id: string): void {
      db.delete(user).where(eq(user.id, id)).run();
    },

    /**
     * By primary key, **ignoring the event**.
     *
     * Only correct where the event isn't known yet and the id came from a
     * credential we already trusted — resolving a session, collecting a claim.
     * Anywhere a caller supplies the id, use `staffInEvent`: this one will happily
     * hand host A a row belonging to host B, which is exactly the leak the tenancy
     * suite exists to catch.
     */
    staffByIdUnscoped(id: string): StaffRow | null {
      return db.select().from(staff).where(eq(staff.id, id)).get() ?? null;
    },

    /** The staff row an account holds at an event, if they hold one. */
    staffForAccount(eventId: string, userId: string): StaffRow | null {
      return (
        db
          .select()
          .from(staff)
          .where(and(eq(staff.eventId, eventId), eq(staff.userId, userId)))
          .get() ?? null
      );
    },

    /** The normal lookup: by id *within* an event, so a foreign id is simply absent. */
    staffInEvent(eventId: string, id: string): StaffRow | null {
      return (
        db
          .select()
          .from(staff)
          .where(and(eq(staff.eventId, eventId), eq(staff.id, id)))
          .get() ?? null
      );
    },

    /** Look up the pending request a device already has, so it can't queue several. */
    pendingStaffForDevice(eventId: string, deviceId: string): StaffRow | null {
      return (
        db
          .select()
          .from(staff)
          .where(
            and(
              eq(staff.eventId, eventId),
              eq(staff.deviceId, deviceId),
              eq(staff.status, 'pending'),
            ),
          )
          .get() ?? null
      );
    },

    /**
     * Whatever staff row this device already has at this event, in any status.
     *
     * Active first: a device that asked, was declined, and later redeemed a code has
     * two rows, and the working one is the answer.
     */
    staffForDevice(eventId: string, deviceId: string): StaffRow | null {
      return (
        db
          .select()
          .from(staff)
          .where(and(eq(staff.eventId, eventId), eq(staff.deviceId, deviceId)))
          .orderBy(sql`(${staff.status} = 'active') DESC`, sql`rowid DESC`)
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
    listStaff(eventId: string): StaffRow[] {
      return db
        .select()
        .from(staff)
        .where(eq(staff.eventId, eventId))
        .orderBy(sql`(${staff.status} = 'pending') DESC`, desc(staff.createdAt), sql`rowid DESC`)
        .all();
    },

    createStaff(s: {
      id: string;
      eventId: string;
      /** Set when this person has an account; null for a device-only helper. */
      userId?: string | null;
      displayName: string;
      deviceId?: string | null;
      status: string;
      claimHash?: string | null;
      claimExpiresAt?: number | null;
      /** Defaults to 'request' — the slow path, where an admin decides. */
      joinedVia?: 'seed' | 'code' | 'request';
    }): void {
      db.insert(staff)
        .values({
          id: s.id,
          eventId: s.eventId,
          userId: s.userId ?? null,
          displayName: s.displayName,
          deviceId: s.deviceId ?? null,
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

    /**
     * End the night: revoke every helper at *this* event and kill their sessions.
     *
     * **Everyone except the person asking.** This used to spare admins by role, and
     * there is no role to spare them by now — but "revoke all helpers" should not
     * sign out the person tapping it, which is exactly what happened the first time
     * this was rewritten. The exemption is the caller's own shift, not a rank.
     *
     * Another party's helpers are untouched.
     */
    revokeAllHelpers(eventId: string, exceptStaffId: string | null = null): void {
      const helpersHere = exceptStaffId
        ? and(eq(staff.eventId, eventId), ne(staff.id, exceptStaffId))
        : eq(staff.eventId, eventId);
      db.update(staff)
        .set({ status: 'revoked' })
        .where(and(helpersHere, eq(staff.status, 'active')))
        .run();
      db.delete(staffSessions)
        .where(
          inArray(
            staffSessions.staffId,
            db.select({ id: staff.id }).from(staff).where(helpersHere),
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

// Every one of these takes the event first. That is the whole of phase 2: the
// scope is a required parameter, so omitting it does not compile.
export const createOrder: Db['createOrder'] = (eventId, input) => d().createOrder(eventId, input);
export const listOrders: Db['listOrders'] = (eventId) => d().listOrders(eventId);
export const setOrderStatus: Db['setOrderStatus'] = (eventId, id, status, handoff) =>
  d().setOrderStatus(eventId, id, status, handoff);
export const bumpOrder: Db['bumpOrder'] = (eventId, id, bumped) =>
  d().bumpOrder(eventId, id, bumped);
export const setItemProgress: Db['setItemProgress'] = (eventId, id, index, made) =>
  d().setItemProgress(eventId, id, index, made);
export const deleteOrder: Db['deleteOrder'] = (eventId, id) => d().deleteOrder(eventId, id);
export const clearOrders: Db['clearOrders'] = (eventId, which) => d().clearOrders(eventId, which);
export const orderDeviceId: Db['orderDeviceId'] = (eventId, id) => d().orderDeviceId(eventId, id);

export const createEvent: Db['createEvent'] = (e) => d().createEvent(e);
export const eventById: Db['eventById'] = (id) => d().eventById(id);
export const updateEvent: Db['updateEvent'] = (id, changes) => d().updateEvent(id, changes);
export const deleteEvent: Db['deleteEvent'] = (id) => d().deleteEvent(id);
export const allEvents: Db['allEvents'] = () => d().allEvents();
export const liveEvents: Db['liveEvents'] = () => d().liveEvents();

// Who is at a party, and whether the bar has let them in. See `event_guest`.
export const joinParty: Db['joinParty'] = (eventId, deviceId, name) =>
  d().joinParty(eventId, deviceId, name);
export const guestAt: Db['guestAt'] = (eventId, deviceId) => d().guestAt(eventId, deviceId);
export const listGuests: Db['listGuests'] = (eventId) => d().listGuests(eventId);
export const setGuestPhoto: Db['setGuestPhoto'] = (eventId, deviceId, photo, photoId) =>
  d().setGuestPhoto(eventId, deviceId, photo, photoId);
export const photoByHash: Db['photoByHash'] = (eventId, photoId) =>
  d().photoByHash(eventId, photoId);
export const setGuestStatus: Db['setGuestStatus'] = (eventId, deviceId, status) =>
  d().setGuestStatus(eventId, deviceId, status);
export const admitAllPending: Db['admitAllPending'] = (eventId) => d().admitAllPending(eventId);
export const eventsForHost: Db['eventsForHost'] = (hostUserId) => d().eventsForHost(hostUserId);

// The cupboard is keyed on the *host*, not the party — see `stock` in schema.ts.
export const listStock: Db['listStock'] = (userId) => d().listStock(userId);
export const setInStock: Db['setInStock'] = (userId, ingredient, inStock) =>
  d().setInStock(userId, ingredient, inStock);
export const listEventMenu: Db['listEventMenu'] = (eventId) => d().listEventMenu(eventId);
export const setEventMenu: Db['setEventMenu'] = (eventId, ids) => d().setEventMenu(eventId, ids);

export const userById: Db['userById'] = (id) => d().userById(id);
export const userByEmail: Db['userByEmail'] = (email) => d().userByEmail(email);
export const allUsers: Db['allUsers'] = () => d().allUsers();
export const setUserRole: Db['setUserRole'] = (id, role) => d().setUserRole(id, role);
export const setUserBan: Db['setUserBan'] = (id, at, reason) => d().setUserBan(id, at, reason);
export const deleteUser: Db['deleteUser'] = (id) => d().deleteUser(id);

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

export const staffByIdUnscoped: Db['staffByIdUnscoped'] = (id) => d().staffByIdUnscoped(id);
export const staffInEvent: Db['staffInEvent'] = (eventId, id) => d().staffInEvent(eventId, id);
export const staffForAccount: Db['staffForAccount'] = (eventId, userId) =>
  d().staffForAccount(eventId, userId);
export const staffByClaim: Db['staffByClaim'] = (hash) => d().staffByClaim(hash);
export const pendingStaffForDevice: Db['pendingStaffForDevice'] = (eventId, deviceId) =>
  d().pendingStaffForDevice(eventId, deviceId);
export const staffForDevice: Db['staffForDevice'] = (eventId, deviceId) =>
  d().staffForDevice(eventId, deviceId);
export const renameStaff: Db['renameStaff'] = (id, name) => d().renameStaff(id, name);
export const listStaff: Db['listStaff'] = (eventId) => d().listStaff(eventId);
export const createStaff: Db['createStaff'] = (s) => d().createStaff(s);
export const setJoinedVia: Db['setJoinedVia'] = (id, via) => d().setJoinedVia(id, via);
export const setStaffStatus: Db['setStaffStatus'] = (id, status, approvedBy) =>
  d().setStaffStatus(id, status, approvedBy);
export const clearStaffClaim: Db['clearStaffClaim'] = (id) => d().clearStaffClaim(id);
export const setStaffClaim: Db['setStaffClaim'] = (id, hash, expiresAt) =>
  d().setStaffClaim(id, hash, expiresAt);
export const deleteStaff: Db['deleteStaff'] = (id) => d().deleteStaff(id);
export const revokeStaff: Db['revokeStaff'] = (id) => d().revokeStaff(id);
export const revokeAllHelpers: Db['revokeAllHelpers'] = (eventId, except) =>
  d().revokeAllHelpers(eventId, except);
export const purgeStalePendingStaff: Db['purgeStalePendingStaff'] = () =>
  d().purgeStalePendingStaff();
export const createStaffSession: Db['createStaffSession'] = (hash, staffId, expiresAt) =>
  d().createStaffSession(hash, staffId, expiresAt);
export const staffSession: Db['staffSession'] = (hash) => d().staffSession(hash);
export const deleteStaffSession: Db['deleteStaffSession'] = (hash) => d().deleteStaffSession(hash);
export const purgeExpiredSessions: Db['purgeExpiredSessions'] = () => d().purgeExpiredSessions();
