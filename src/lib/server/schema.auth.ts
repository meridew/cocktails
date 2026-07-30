/**
 * Better Auth's tables. Kept apart from `schema.ts` because this shape is not ours
 * to design — the library reads these models by name, and renaming a property
 * breaks it at runtime rather than at compile time.
 *
 * The **property** names must match Better Auth's field names exactly (`emailVerified`,
 * not `email_verified`); the column names in the second argument are ours, so the
 * database stays snake_case like the rest of it.
 *
 * These sit alongside `staff`, they don't replace it. An `account` is a *host* who
 * signs up, owns events and can sign in from anywhere. `staff` is who is behind the
 * bar tonight, identified by a device and let in with a PIN or a join code — which
 * survives precisely because typing an email and password mid-party is the misery
 * the keypad removed. Phase 2 joins the two through event membership.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
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
