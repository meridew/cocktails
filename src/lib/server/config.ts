import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * The environment, from both places it can come from.
 *
 * `process.env` alone is wrong: Vite doesn't load `.env` into it for server modules
 * during `vite dev`, so reading it directly worked in the built container and
 * silently fell back to dev defaults locally — the configured PIN was rejected on a
 * machine where it was set.
 *
 * `$env/dynamic/private` alone is also wrong: it includes `.env`, which a test run
 * must not inherit. Real VAPID keys leaking in would turn every order-status test
 * into an outbound network call.
 *
 * So: `.env` provides the baseline and `process.env` overrides it. Tests set what
 * they need (see the `env` block in vite.config.ts) and win.
 */
const ENV: NodeJS.ProcessEnv = { ...(env as NodeJS.ProcessEnv), ...process.env };

/**
 * Seed staff password. In production, a MISSING secret must never fall back to
 * a known/guessable value — so we lock the account behind a random password
 * until STAFF_PASSWORD is set. Dev uses a fixed convenience password (localhost).
 */
export function resolveStaffPassword(env: NodeJS.ProcessEnv = process.env): string {
  const p = env.STAFF_PASSWORD;
  if (p) return p;
  if (env.NODE_ENV === 'production') return randomBytes(24).toString('hex');
  return 'cocktails';
}

/**
 * Admin PIN — the everyday way into the bar, because typing an email and a long
 * password on a phone mid-party is miserable.
 *
 * Empty means PIN sign-in is simply unavailable (the endpoint refuses everything);
 * email + password still works, so an unset secret degrades to "no PIN door"
 * rather than "no way in". As with the password, production never falls back to a
 * guessable default — only localhost gets a convenience value.
 */
export function resolveStaffPin(env: NodeJS.ProcessEnv = process.env): string {
  const pin = env.STAFF_PIN?.trim();
  if (pin) return pin;
  return env.NODE_ENV === 'production' ? '' : '000000';
}

/**
 * Signing key for host account sessions (Better Auth).
 *
 * Same rule as the staff password: production never falls back to something
 * guessable. The consequence of a missing secret is that a random one is minted
 * per boot, so every account session dies on restart — noisy and obvious, which
 * is the right failure mode for a missing secret. Dev gets a fixed value so the
 * loop doesn't sign you out on every reload.
 */
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.BETTER_AUTH_SECRET?.trim();
  if (s) return s;
  if (env.NODE_ENV === 'production') return randomBytes(32).toString('hex');
  return 'dev-only-insecure-not-for-production';
}

/**
 * CORS origins allowed to call the API. `ALLOWED_ORIGIN` is a comma-separated
 * list. In production the website is same-origin via Caddy (no CORS needed), so
 * the only cross-origin callers are the native app WebViews — we default to
 * those rather than a wide-open '*'.
 */
export function resolveAllowedOrigin(env: NodeJS.ProcessEnv = process.env): string | string[] {
  const raw = env.ALLOWED_ORIGIN;
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (env.NODE_ENV === 'production') {
    return ['capacitor://localhost', 'https://localhost'];
  }
  return '*'; // dev convenience — the app and API are same-origin anyway
}

/** Runtime configuration, all overridable by environment variables. */
export const config = {
  /** CORS origin(s) allowed to call the API. */
  allowedOrigin: resolveAllowedOrigin(ENV),
  /**
   * Seed staff account, created on first boot if the staff table is empty.
   * Dev defaults make localhost work out of the box; set real values via env
   * (STAFF_EMAIL / STAFF_PASSWORD / STAFF_PIN) in production.
   */
  staff: {
    email: (ENV.STAFF_EMAIL || 'bar@local').trim().toLowerCase(),
    password: resolveStaffPassword(ENV),
    /** Short PIN for the same admin account. Empty → PIN sign-in is off. */
    pin: resolveStaffPin(ENV),
  },
  /**
   * Host accounts — the sign-up side, separate from the bar's PIN and join codes.
   * `origin` is what verification links are built against, so it must be the URL
   * the host actually clicks, not the port the server binds.
   */
  accounts: {
    secret: resolveAuthSecret(ENV),
    origin: (ENV.ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
    /**
     * Sign in with Google. Both halves present → the button appears; either
     * missing → it doesn't, and email/password carries on alone.
     *
     * Unlike Graph, this genuinely needs a *secret*: the OAuth authorization-code
     * flow has no certificate option. Nothing to be done about that.
     */
    google: {
      clientId: (ENV.GOOGLE_CLIENT_ID ?? '').trim(),
      clientSecret: (ENV.GOOGLE_CLIENT_SECRET ?? '').trim(),
    },
  },
  /**
   * Microsoft Graph, for outbound email. Any piece missing → the logging sender,
   * so a half-configured tenant degrades to "the link is in the log" rather than
   * to sign-ups that fail with nothing to show for it.
   */
  graph: {
    tenantId: (ENV.GRAPH_TENANT_ID ?? '').trim(),
    clientId: (ENV.GRAPH_CLIENT_ID ?? '').trim(),
    /**
     * Path to a PEM holding the private key and its certificate. A path rather
     * than the value itself because a PEM is multi-line, and because the key
     * should live in a 600 file that nothing ever prints — only its public half
     * is uploaded to Entra.
     */
    keyFile: (ENV.GRAPH_KEY_FILE ?? '').trim(),
    sender: (ENV.GRAPH_SENDER || 'bar@meridew.com').trim(),
  },
  /** SQLite file path. Relative to the app's working directory. */
  dbPath: ENV.DB_PATH || './data/cocktails.sqlite',
  /**
   * Web Push (VAPID). Empty keys → push is disabled and the sender no-ops.
   * Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (secret!) / VAPID_SUBJECT in env.
   */
  vapid: {
    subject: ENV.VAPID_SUBJECT || 'mailto:bar@meridew.com',
    publicKey: ENV.VAPID_PUBLIC_KEY ?? '',
    privateKey: ENV.VAPID_PRIVATE_KEY ?? '',
  },
} as const;
