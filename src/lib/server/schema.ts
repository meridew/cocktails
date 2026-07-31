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
 * A party. Everything below is scoped to one.
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
   * Nullable, and only for one case: the default event seeded at boot so the app
   * works before anybody has signed up. Every event a host creates has an owner.
   * Making this NOT NULL would mean inventing a user account at boot to satisfy a
   * foreign key, which is a worse lie than an honest null.
   */
  hostUserId: text('host_user_id').references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** epoch ms; null while the host is still deciding. */
  startsAt: integer('starts_at'),
  /** 'draft' | 'live' | 'done'. Exactly one event is live at a time, for now. */
  status: text('status').notNull().default('live'),
  createdAt: integer('created_at').notNull(),
});

/**
 * What the host actually has in, which phase 3 turns into a menu.
 *
 * A row exists only for an ingredient the host has said something about; absence
 * means "not mentioned", which the generator treats as not available.
 */
export const inventory = sqliteTable(
  'inventory',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    ingredient: text('ingredient').notNull(),
    inStock: integer('in_stock', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.ingredient] })],
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
 * email and password_hash are nullable on purpose: an approved helper has neither
 * (their identity is a device, their credential is a session), while an admin has
 * both so they can sign in from any device. SQLite permits many NULLs under a
 * UNIQUE index, so several helpers coexist without emails.
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
  /** Set when this person has a host account; null for a device-only helper. */
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  displayName: text('display_name').notNull().default(''),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  deviceId: text('device_id'),
  role: text('role').notNull().default('bartender'),
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

/**
 * Short-lived codes the host reads out to onboard a helper on the spot. Only the
 * SHA-256 is stored: a stolen database shouldn't hand anyone the bar. Reusable
 * until they expire, because one code often onboards several people.
 */
export const joinCodes = sqliteTable('join_codes', {
  codeHash: text('code_hash').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
});
