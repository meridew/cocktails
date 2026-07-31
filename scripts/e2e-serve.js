/**
 * The server the end-to-end suite drives.
 *
 * It is the **real** built app — `build/index.js`, the same artefact launchd runs on
 * the Mac — with three things pointed somewhere disposable:
 *
 *   DB_PATH        a throwaway SQLite file, deleted on every start
 *   EMAIL_OUTBOX   verification links, readable from the specs
 *   ORIGIN         so those links point at the port Playwright is on
 *
 * Wiping happens *here* rather than in Playwright's `globalSetup` because the order
 * of `webServer` and `globalSetup` is a detail of Playwright's that this should not
 * depend on. The server owns its own database; deleting it a line before opening it
 * cannot race with anything.
 *
 * Run it directly to poke at a clean instance by hand:
 *
 *     npm run build && node scripts/e2e-serve.js
 */
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PORT = process.env.PORT ?? '4173';
const dbPath = resolve(process.env.DB_PATH ?? './.e2e/cocktails.sqlite');
const outbox = resolve(process.env.EMAIL_OUTBOX ?? './.e2e/outbox.jsonl');

// A stale WAL outlives its database file, so all three go or none do.
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(dirname(outbox), { recursive: true });
// Truncate rather than delete: the specs tail this file, and a path that does not
// exist yet reads as "no mail" identically to an empty one — until a spec races the
// first write and gets ENOENT. One empty file removes the case.
writeFileSync(outbox, '');

process.env.DB_PATH = dbPath;
process.env.EMAIL_OUTBOX = outbox;
process.env.PORT = PORT;
process.env.ORIGIN ??= `http://127.0.0.1:${PORT}`;
process.env.HOST ??= '127.0.0.1';
// Admin is a real account; this only says which one. The suite registers it through
// the front door like anybody else.
process.env.ADMIN_EMAILS ??= 'admin@e2e.test';
// Empty VAPID keys disable push entirely, so nothing tries to reach a push service
// from a test run. The endpoints still answer; the sender no-ops.
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
// A fixed secret, so a restart mid-suite doesn't invalidate every session. It is
// only ever this process, on loopback, against a database that is about to be
// deleted.
// 32+ characters, because Better Auth warns below that and the warning is right —
// but this one is only ever this process, on loopback, against a database that is
// about to be deleted.
process.env.BETTER_AUTH_SECRET ??= 'e2e-only-not-a-secret-0123456789abcdef';

if (!existsSync(resolve('build/index.js'))) {
  console.error('no build/index.js — run `npm run build` first');
  process.exit(1);
}

await import('../build/index.js');
