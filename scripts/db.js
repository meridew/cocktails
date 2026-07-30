/**
 * Database fixtures, so getting to a known state is one command.
 *
 * This exists because building test state by hand — sign in, place six orders,
 * advance three of them, mint a code — was costing a pile of round-trips every
 * time, and doing it through the UI is slower still. `npm run db:seed busy` is
 * the whole thing.
 *
 * It talks to the schema directly rather than over HTTP: no server needs to be
 * running, and it can reset a database the server is about to open.
 *
 * Safe by construction — it refuses to touch anything but a local file, so it
 * can't be pointed at the NAS by accident.
 *
 *   node scripts/db.js reset          empty schema + the seeded admin
 *   node scripts/db.js seed busy      a queue mid-service
 *   node scripts/db.js seed helper    a helper waiting for approval
 *   node scripts/db.js show           what's in there
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const DB_PATH = process.env.DB_PATH ?? './data/cocktails.sqlite';
const path = resolve(DB_PATH);

if (/^https?:/i.test(DB_PATH)) {
  console.error('db.js only works on a local file');
  process.exit(1);
}

const id = () => randomBytes(6).toString('hex');
const now = () => Date.now();

/**
 * Empty the database.
 *
 * Deleting the file is the cleaner option — the migrations replay from scratch on
 * the next boot. But Windows refuses to unlink a file another process has open,
 * and the dev server usually does. So if that fails, empty every table in place
 * instead: same observable result, and it doesn't require stopping the server.
 *
 * Emptying deliberately skips `__drizzle_migrations`, so the schema survives and
 * only the data goes. Dropping that table would leave the schema in place while
 * claiming nothing had been applied, and the next boot would fail re-creating
 * tables that already exist.
 */
function reset() {
  try {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    mkdirSync(dirname(path), { recursive: true });
    console.log(`🗑  deleted ${DB_PATH}`);
    console.log('   start the server to recreate the schema and seed the admin');
    return;
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
  }

  const db = new Database(path);
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`,
    )
    .all();
  for (const { name } of tables) db.prepare(`DELETE FROM ${name}`).run();
  db.close();
  console.log(`🗑  emptied ${tables.length} tables in ${DB_PATH} (file is open elsewhere)`);
  console.log('   restart the server to re-seed the admin account');
}

function open() {
  if (!existsSync(path)) {
    console.error(`no database at ${DB_PATH} — start the server once to create it`);
    process.exit(1);
  }
  return new Database(path);
}

const SCENARIOS = {
  /** A queue mid-service: orders across every status, one bumped, one part-poured. */
  busy(db) {
    const insert = db.prepare(
      `INSERT INTO orders (id, name, items, note, status, device_id, bumped_at, handoff, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rows = [
      ['Priya', [{ name: 'Moscow Mule', qty: 2, made: 1 }], 'light on the lime', 'making'],
      ['Sam', [{ name: 'Mojito', qty: 1 }], '', 'pending'],
      ['Tom', [{ name: 'Margarita', qty: 3 }], '', 'pending'],
      ['Nadia', [{ name: 'Wine', qty: 1 }], '', 'serving'],
      ['Marco', [{ name: 'Old Fashioned', qty: 1 }], 'extra ice', 'done'],
      ['Zoë', [{ name: 'Pom & Elderflower', qty: 2 }], '', 'pending'],
    ];
    rows.forEach(([name, items, note, status], i) => {
      const ts = now() - (rows.length - i) * 90_000;
      insert.run(
        id(),
        name,
        JSON.stringify(items),
        note,
        status,
        `dev-${String(name).toLowerCase()}`,
        name === 'Tom' ? now() : null,
        status === 'serving' ? 'deliver' : null,
        ts,
        ts,
      );
    });
    console.log(`🍸 ${rows.length} orders across every status (Tom bumped, Priya part-poured)`);
  },

  /** Someone waiting on the host, so the approval flow has something to answer. */
  helper(db) {
    db.prepare(
      `INSERT INTO staff (id, display_name, email, password_hash, device_id, role, status,
                          claim_hash, claim_expires_at, joined_via, approved_by, created_at)
       VALUES (?, ?, NULL, NULL, ?, 'bartender', 'pending', ?, ?, 'request', NULL, ?)`,
    ).run(id(), 'Marco', 'dev-marco', randomBytes(32).toString('hex'), now() + 3600_000, now());
    console.log('🙋 one helper pending approval (Marco)');
  },
};

function show(db) {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(`   orders        ${count('orders')}`);
  console.log(`   staff         ${count('staff')}`);
  console.log(`   subscriptions ${count('subscriptions')}`);
  console.log(`   join_codes    ${count('join_codes')}`);
  for (const s of db.prepare(`SELECT display_name, role, status FROM staff`).all()) {
    console.log(`     · ${s.display_name} (${s.role}/${s.status})`);
  }
}

const [command, scenario] = process.argv.slice(2);

if (command === 'reset') {
  reset();
} else if (command === 'seed') {
  const run = SCENARIOS[scenario ?? 'busy'];
  if (!run) {
    console.error(`unknown scenario "${scenario}" — try: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  const db = open();
  run(db);
  show(db);
  db.close();
} else if (command === 'show') {
  const db = open();
  show(db);
  db.close();
} else {
  console.error('usage: node scripts/db.js reset | seed [busy|helper] | show');
  process.exit(1);
}
