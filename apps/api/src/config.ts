/** Bartender secret: required in production, convenient default in dev. */
function resolveBartenderKey(): string {
  const k = process.env.BARTENDER_KEY;
  if (k) return k;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BARTENDER_KEY must be set in production');
  }
  return '1337'; // dev-only default
}

/** Runtime configuration, all overridable by environment variables. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** CORS origin allowed to call the API. '*' only for local dev. */
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',
  /** Bartender shared secret. Replaced by a proper staff login in Phase 3. */
  bartenderKey: resolveBartenderKey(),
  /** SQLite file path (a Docker volume on the NAS). Relative to the API cwd. */
  dbPath: process.env.DB_PATH ?? './data/cocktails.sqlite',
} as const;
