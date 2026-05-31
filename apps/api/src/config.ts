/** Runtime configuration, all overridable by environment variables. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** CORS origin allowed to call the API. '*' only for local dev. */
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',
  /** Bartender shared secret. Replaced by a proper staff login in Phase 3. */
  bartenderKey: process.env.BARTENDER_KEY ?? '1337',
  /** SQLite file path (a Docker volume on the NAS). Relative to the API cwd. */
  dbPath: process.env.DB_PATH ?? './data/cocktails.sqlite',
} as const;
