/** Bartender secret: required in production, convenient default in dev. */
function resolveBartenderKey(): string {
  const k = process.env.BARTENDER_KEY;
  if (k) return k;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BARTENDER_KEY must be set in production');
  }
  return '1337'; // dev-only default
}

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
  /** Bartender shared secret. Replaced by a proper staff login in Phase 3. */
  bartenderKey: resolveBartenderKey(),
  /** SQLite file path (a Docker volume on the NAS). Relative to the API cwd. */
  dbPath: process.env.DB_PATH ?? './data/cocktails.sqlite',
} as const;
