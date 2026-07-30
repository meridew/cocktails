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

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
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
