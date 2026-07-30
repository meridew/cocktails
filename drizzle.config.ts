import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` diffs schema.ts against the migrations in ./drizzle and
 * writes the SQL for whatever changed. Migrations are *applied* at runtime by
 * `createDb`, not by the CLI, so one code path covers boot, dev and tests alike.
 */
export default defineConfig({
  schema: './src/lib/server/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DB_PATH ?? './data/cocktails.sqlite' },
});
