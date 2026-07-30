/**
 * Host accounts — sign up, verify, sign in, reset — on Better Auth.
 *
 * Deliberately separate from `auth.ts`, which is the *bar's* door: a device, a PIN
 * and a join code. That stays, because typing an email and a password behind a bar
 * mid-party is exactly the misery the keypad removed. This is for hosts, who need
 * to own their data and sign in from a phone they've never used before.
 *
 * Mounted at **`/api/account`**, not Better Auth's default `/api/auth`, because
 * that path is already the staff routes. Two auth systems with distinct jobs read
 * better under distinct names than under one namespace with collisions in it.
 *
 * Lazy, like the database handle it borrows: importing this module must not open a
 * file or read a secret, so a typecheck or a test that never signs anyone in pays
 * nothing.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { orm } from './db';
import * as schema from './schema.auth';
import { config } from './config';
import { sendEmail } from './email';

export const ACCOUNT_BASE_PATH = '/api/account';

/**
 * Built in its own function so the instance type is inferred from *these* options.
 * Annotating it as `ReturnType<typeof betterAuth>` looks tidier and is wrong:
 * Better Auth's `Auth<T>` is generic over the exact options object, so the
 * annotation widens `T` to `BetterAuthOptions` — where `secret` is optional — and
 * the two no longer match.
 */
const build = () =>
  betterAuth({
    secret: config.accounts.secret,
    baseURL: config.accounts.origin,
    basePath: ACCOUNT_BASE_PATH,

    // Same handle as everything else: one database, one WAL, one set of
    // migrations. A second connection to the same SQLite file would be a
    // writer-contention bug waiting to happen.
    database: drizzleAdapter(orm(), { provider: 'sqlite', schema }),

    emailAndPassword: {
      enabled: true,
      // A host's email is how we reach them about their own event, so it has to
      // be real before the account is usable.
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Reset your cocktails password',
          text: `Someone asked to reset the password for this account.\n\n${url}\n\nIf that wasn't you, ignore this — nothing has changed.`,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      // Verifying is proof enough of the address; making them sign in again
      // immediately afterwards is a step that teaches nobody anything.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Confirm your email for cocktails',
          text: `Confirm this address to finish setting up your account.\n\n${url}`,
        });
      },
    },
  });

let instance: ReturnType<typeof build> | undefined;

export function accounts(): ReturnType<typeof build> {
  return (instance ??= build());
}

/** Forget the instance, for tests that need a different sender or database. */
export function resetAccounts(): void {
  instance = undefined;
}
