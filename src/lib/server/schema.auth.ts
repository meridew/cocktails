/**
 * Better Auth's tables. Kept apart from `schema.ts` because this shape is not ours
 * to design — the library reads these models by name, and renaming a property
 * breaks it at runtime rather than at compile time.
 *
 * The **property** names must match Better Auth's field names exactly (`emailVerified`,
 * not `email_verified`); the column names in the second argument are ours, so the
 * database stays snake_case like the rest of it.
 *
 * These sit alongside `staff`, they don't replace it. A `user` is a *person with an
 * account* — Dan, or a host. `staff` is who is behind the bar tonight, identified by
 * a device and let in with a join code, which survives precisely because typing an
 * email and password mid-party is the misery the keypad removed.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),

  /**
   * The account role — the first of the two axes capabilities come from.
   *
   * Ours, not Better Auth's, but it lives on their table because it is a property of
   * the person rather than of anything else. It is declared to Better Auth in
   * `accounts.ts` under `user.additionalFields` with **`input: false`**: without
   * that, a sign-up could post `{"role":"admin"}` and grant itself the platform.
   * `tests/accounts.test.ts` proves that door is shut rather than trusting it.
   *
   * `ADMIN_EMAILS` outranks this column and is re-asserted on every session
   * resolution, so config is the truth and no edit made inside the app can lock the
   * operator out of their own service.
   */
  role: text('role').notNull().default('host'),

  /**
   * Suspension. Open sign-up means strangers can register, so there has to be a way
   * to stop one — and a reason, because "why can't I sign in" is a question someone
   * will ask.
   *
   * Nullable rather than a boolean plus a timestamp: one column that is either null
   * or the moment it happened can't disagree with itself.
   */
  bannedAt: integer('banned_at'),
  banReason: text('ban_reason'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

/**
 * One row per way of signing in: the password credential, and one per OAuth
 * provider. Deleting the user cascades, so "delete my account" doesn't strand
 * a Google link pointing at nothing.
 */
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  /** Hashed by Better Auth (scrypt). Null for OAuth-only accounts. */
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/** Short-lived tokens for email verification and password reset. */
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});
