/**
 * The database schema, declared once for Drizzle.
 *
 * This file is the single source of truth: `drizzle-kit generate` diffs it to
 * produce the migrations in `drizzle/`, and every query in `db.ts` is typed from
 * it. Change a column here, generate, and both the SQL and the TypeScript follow.
 *
 * Column names stay snake_case on disk and camelCase in TypeScript — the second
 * argument to each column is the real name, so an existing database needs no
 * rewriting and the app code reads naturally.
 */
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { user } from './schema.auth';

// Better Auth's own tables, re-exported so drizzle-kit sees one schema and the
// migrations cover both. Their shape is the library's, not ours — see the file.
export * from './schema.auth';

/**
 * A party. The orders and the menu are scoped to one.
 *
 * **`user` is the plan's `account`.** The original domain model (now `HISTORY.md`) listed an
 * `account` table, but Better Auth already provides exactly that under the name
 * `user` — *and* it owns a different table literally called `account`, which holds
 * provider credentials. Adding a third identity table to match the doc's wording
 * would have been the worst of both. So a host is a `user`, and `event.hostUserId`
 * points at them.
 */
export const event = sqliteTable('event', {
  id: text('id').primaryKey(),
  /**
   * **NOT NULL**, which is new and load-bearing.
   *
   * It used to be nullable for one case: an event seeded at boot so the app worked
   * before anyone had signed up. That seed is gone, and with it `liveEvent()`'s guess
   * at which party a guest meant. Every party now belongs to a host, because the
   * cupboard the menu is generated from hangs off that host — a party with no owner
   * would be a party with no menu.
   */
  hostUserId: text('host_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** epoch ms; null until it's booked in. Never opens the party on its own — §2d. */
  startsAt: integer('starts_at'),
  /**
   * `draft` → `live` → `done`, moved by hand.
   *
   * Several parties can be live at once, which is why nothing may ever infer "the"
   * live event again. A guest arrives at `/e/<id>` and names their party or they
   * don't order.
   */
  status: text('status').notNull().default('draft'),
  /**
   * What the host has turned on for this party, as JSON — see `$lib/shared/party`
   * for the shape and for why it is one column rather than a boolean each.
   *
   * **Nullable, and null means "everything on".** Every party that predates this
   * column has one, and none of them should change on deploy.
   */
  settings: text('settings'),
  createdAt: integer('created_at').notNull(),
});

/**
 * What a **host** has in — the cupboard the menu is generated from.
 *
 * Keyed on the user, not the event, and that is the whole point: a home bar is
 * fairly stable, and re-ticking 173 bottles for every party is a chore nobody
 * repeats. One cupboard, read by every party they ever have.
 *
 * A row exists only for an ingredient somebody has said something about. **Absence
 * is not "no".** No rows at all means the host has never opened the screen, and the
 * menu offers everything rather than nothing; a row set `false` is how "asked and
 * answered: no" is remembered, which is why unticking writes rather than deletes.
 */
export const stock = sqliteTable(
  'stock',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ingredient: text('ingredient').notNull(),
    inStock: integer('in_stock', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ingredient] })],
);

/**
 * The short list — what this party leads with.
 *
 * **No rows means show everything.** Curation is optional, and an uncurated party
 * must not look like a broken one; same rule as the cupboard above, for the same
 * reason. Scoped to the event rather than the host because a menu curated for a
 * birthday shouldn't follow them to Christmas.
 */
export const eventMenu = sqliteTable(
  'event_menu',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** A `Recipe.id` from `$lib/shared/recipes`. Not a foreign key — recipes are data, not rows. */
    recipeId: text('recipe_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.recipeId] })],
);

/**
 * Who is at a party, and whether the bar has let them in.
 *
 * **The approval is on the person, not the drink.** A guest is admitted once and
 * everything they order that night flows normally; without this, the bar would be
 * approving the same stranger's third round as if it had never seen them.
 *
 * **The guest never sees it.** They join, they order, they get the celebration —
 * exactly as before. Their drinks simply do not reach the bar's working queue until
 * somebody admits them, which from their side is indistinguishable from a bartender
 * who hasn't got to them yet. That was the explicit requirement: a gate the person
 * being gated cannot perceive.
 *
 * Keyed on `device_id` because a guest has no account and never will — the whole
 * point of the guest role. That makes this **a soft handle, not an identity**:
 * clearing site data mints a new device and re-queues you as a new face. It is a
 * speed bump against a stranger who found the domain, not an access control, and
 * pretending otherwise would be the dangerous mistake here. The real control is that
 * a human reads every name before pouring anything.
 */
export const eventGuest = sqliteTable(
  'event_guest',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** From `getDeviceId()`. Not an identity; see above. */
    deviceId: text('device_id').notNull(),
    /** Given once when they join, and reused on every round afterwards. */
    name: text('name').notNull(),
    /** `pending` until the bar admits them. `blocked` is a deliberate no. */
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    /** When somebody let them in — null while pending. */
    admittedAt: integer('admitted_at'),
    /**
     * An optional selfie, so the bar can put a face to a name.
     *
     * **A base64 WebP, in the row.** It is the first binary this app has stored, and
     * a blob in SQLite is the smallest way to do it: one process, one file, no bucket
     * to configure, and it cascades away with the party for free. The client crops and
     * resizes to 256px before sending, which lands at three to eight kilobytes — two
     * hundred guests is under two megabytes.
     *
     * Null is the ordinary case, not a failure: the photo is optional and the bar
     * falls back to initials.
     */
    photo: text('photo'),
    /**
     * A content hash of `photo`, or null.
     *
     * It does two jobs. It is the URL the bar fetches the image by, and because it
     * changes only when the picture does, that URL can be cached forever — which
     * matters when the bar re-polls every four seconds and would otherwise be handed
     * the same faces over and over. And it lets a returning guest's device ask "have
     * you got this one already?" without uploading anything.
     */
    photoId: text('photo_id'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.deviceId] })],
);

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  /**
   * The party this drink belongs to. Required, and the reason phase 2 exists: two
   * hosts must never see each other's queue. Every query that touches this table
   * takes the event as its first argument, so forgetting the scope is a compile
   * error rather than a silent leak.
   */
  eventId: text('event_id')
    .notNull()
    .references(() => event.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** JSON-encoded OrderItem[]. Parsed defensively in db.ts — a corrupt row must
   *  never throw at the API boundary. */
  items: text('items').notNull(),
  note: text('note').notNull().default(''),
  status: text('status').notNull().default('pending'),
  deviceId: text('device_id'),
  bumpedAt: integer('bumped_at'),
  handoff: text('handoff'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    deviceId: text('device_id').notNull(),
    role: text('role').notNull(),
    subscription: text('subscription').notNull(),
    endpoint: text('endpoint').notNull(),
    transport: text('transport').notNull().default('webpush'),
    platform: text('platform').notNull().default('web'),
    createdAt: integer('created_at').notNull(),
  },
  // role is part of the key: one device legitimately holds BOTH roles (the host
  // runs the bar and orders drinks). With (device_id, endpoint) alone, registering
  // one role overwrote the other and silently killed its pushes.
  (t) => [primaryKey({ columns: [t.deviceId, t.endpoint, t.role] })],
);

/**
 * Who is behind the bar at one party.
 *
 * **There is no `role` column any more, and no email or password either.** The
 * distinction this table used to carry — admin vs bartender — was never a fact about
 * a shift; it was a fact about a *person*, and it lives on `user.role` now. Everyone
 * listed here does the same job: they take orders at this party and nothing else.
 *
 * Credentials went the same way. A helper's identity is a device and their
 * credential is a session handed over by a join code; the one person who used to
 * sign in here with an email now has a real account, so `staff` holds no secrets at
 * all beyond the claim hash a pending helper redeems.
 */
export const staff = sqliteTable('staff', {
  id: text('id').primaryKey(),
  /**
   * Which party they are working. This table *is* the plan's `event_member`.
   *
   * A separate membership table was the obvious reading of the original §5, but it
   * only works if every participant has an account — and helpers deliberately don't.
   * Their whole appeal is that a join code gets them in with nothing to invent or
   * remember. Two membership tables, one for account-holders and one for devices,
   * would then have to be kept in agreement about who may do what, which is the
   * exact class of bug §6 exists to kill. So: one table, and `userId` is how a row
   * gains an account rather than a second table.
   */
  eventId: text('event_id')
    .notNull()
    .references(() => event.id, { onDelete: 'cascade' }),
  /** Set when this person has an account; null for a device-only helper. */
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  displayName: text('display_name').notNull().default(''),
  deviceId: text('device_id'),
  status: text('status').notNull().default('active'),
  claimHash: text('claim_hash'),
  claimExpiresAt: integer('claim_expires_at'),
  /**
   * How they got in: 'seed' | 'code' | 'request'. Separate from approvedBy, which
   * is the admin who decided — a join code has no such person, and squeezing both
   * facts into one column meant a 'join-code' sentinel string.
   */
  joinedVia: text('joined_via').notNull().default('request'),
  approvedBy: text('approved_by'),
  createdAt: integer('created_at').notNull(),
});

export const staffSessions = sqliteTable('staff_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  staffId: text('staff_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});
