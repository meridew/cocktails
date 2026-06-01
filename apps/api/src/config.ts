/**
 * CORS origins allowed to call the API. `ALLOWED_ORIGIN` is a comma-separated
 * list. In production the website is same-origin via Caddy (no CORS needed), so
 * the only cross-origin callers are the native app WebViews — we default to
 * those rather than a wide-open '*'.
 */
function resolveAllowedOrigin(): string | string[] {
  const raw = process.env.ALLOWED_ORIGIN;
  if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production') {
    return ['capacitor://localhost', 'https://localhost'];
  }
  return '*'; // dev convenience (the Vite proxy is same-origin anyway)
}

/** Runtime configuration, all overridable by environment variables. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** CORS origin(s) allowed to call the API. */
  allowedOrigin: resolveAllowedOrigin(),
  /**
   * Seed staff account, created on first boot if the staff table is empty.
   * Dev defaults make localhost work out of the box; set real values via env
   * (STAFF_EMAIL / STAFF_PASSWORD) in production.
   */
  staff: {
    email: (process.env.STAFF_EMAIL ?? 'bar@local').trim().toLowerCase(),
    password: process.env.STAFF_PASSWORD ?? 'cocktails',
  },
  /** SQLite file path (a Docker volume on the NAS). Relative to the API cwd. */
  dbPath: process.env.DB_PATH ?? './data/cocktails.sqlite',
  /**
   * Web Push (VAPID). Empty keys → push is disabled and the sender no-ops.
   * Generate a pair with `npm -w @cocktails/api run gen-vapid`, then set
   * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (secret!) / VAPID_SUBJECT in env.
   */
  vapid: {
    subject: process.env.VAPID_SUBJECT ?? 'mailto:bar@meridew.com',
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  },
} as const;
