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
  /**
   * A queue mid-service: orders across every status, one bumped, one part-poured.
   *
   * Every order belongs to a party — `orders.event_id` is NOT NULL and has been
   * since tenancy landed, which this scenario silently predated and died on. It
   * attaches to the first live party, or the first party of any kind.
   *
   * Guests are admitted except one, deliberately. The bar's admit control only
   * appears for a face it has not been introduced to, so a seed where everyone is
   * already in cannot show you what that looks like.
   */
  busy(db) {
    const event =
      db.prepare(`SELECT id, name FROM event WHERE status = 'live' ORDER BY created_at`).get() ??
      db.prepare(`SELECT id, name FROM event ORDER BY created_at`).get();
    if (!event) {
      console.error('no parties yet — make one from /admin first');
      return;
    }

    const insert = db.prepare(
      `INSERT INTO orders (id, event_id, name, items, note, status, device_id, bumped_at, handoff, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const admit = db.prepare(
      `INSERT INTO event_guest (event_id, device_id, name, status, created_at, admitted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id, device_id) DO UPDATE SET status = excluded.status`,
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
      const device = `dev-${String(name).toLowerCase()}`;
      // Zoë is the stranger the bar has to wave in.
      const admitted = name !== 'Zoë';
      admit.run(
        event.id,
        device,
        name,
        admitted ? 'admitted' : 'pending',
        ts,
        admitted ? ts : null,
      );
      insert.run(
        id(),
        event.id,
        name,
        JSON.stringify(items),
        note,
        status,
        device,
        name === 'Tom' ? now() : null,
        status === 'serving' ? 'deliver' : null,
        ts,
        ts,
      );
    });
    console.log(
      `🍸 ${rows.length} orders on "${event.name}" across every status ` +
        '(Tom bumped, Priya part-poured, Zoë waiting to be let in)',
    );
  },

  /**
   * A host with a bar somebody would actually throw a party from.
   *
   * The generated menu is only worth looking at with a real cupboard behind it — a
   * host with four bottles gets five drinks, which proves the plumbing and tells you
   * nothing about whether the screen works. This is roughly what a well-stocked
   * kitchen has in: five spirits, the mixers, the citrus and the sweeteners.
   *
   * Ticks it for **every** host, because which one you happen to be signed in as is
   * not the thing being tested.
   */
  stocked(db) {
    const bottles = [
      // spirits
      'Gin',
      'Vodka',
      'White Rum',
      'Dark Rum',
      'Tequila',
      'Bourbon',
      // fortified & liqueurs
      'Sweet Vermouth',
      'Dry Vermouth',
      'Campari',
      'Aperol',
      'Triple Sec',
      'Coffee Liqueur',
      // citrus & juice
      'Lime Juice',
      'Lemon Juice',
      'Orange Juice',
      'Cranberry Juice',
      'Pineapple Juice',
      // mixers
      'Soda Water',
      'Tonic Water',
      'Ginger Beer',
      'Cola',
      'Prosecco',
      // sweeteners & the rest
      'Simple Syrup',
      'Agave Syrup',
      'Honey Syrup',
      'Grenadine',
      'Angostura Bitters',
      'Mint',
      'Egg White',
      'Espresso',
    ];
    const users = db.prepare(`SELECT id, name FROM user`).all();
    if (users.length === 0) {
      console.error('no hosts yet — start the server once, or register somebody');
      return;
    }
    const tick = db.prepare(
      `INSERT INTO stock (user_id, ingredient, in_stock) VALUES (?, ?, 1)
         ON CONFLICT (user_id, ingredient) DO UPDATE SET in_stock = 1`,
    );
    for (const u of users) for (const b of bottles) tick.run(u.id, b);
    console.log(`🥃 ${bottles.length} bottles in for ${users.map((u) => u.name).join(', ')}`);
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
  console.log(`   hosts         ${count('user')}`);
  console.log(`   parties       ${count('event')}`);
  console.log(`   orders        ${count('orders')}`);
  console.log(`   staff         ${count('staff')}`);
  console.log(`   subscriptions ${count('subscriptions')}`);
  // `join_codes` used to be counted here. The table went with the one-way-in
  // migration, and this line kept asking for it — which made `db.js show` and every
  // scenario after it die on "no such table".
  console.log(`   guests        ${count('event_guest')}`);
  // A host's cupboard and a party's short list, because both are now the difference
  // between a menu worth looking at and an empty screen.
  for (const u of db
    .prepare(
      `SELECT u.name, u.email,
              (SELECT COUNT(*) FROM stock s WHERE s.user_id = u.id AND s.in_stock) AS bottles
         FROM user u ORDER BY u.name`,
    )
    .all()) {
    console.log(`     · ${u.name} <${u.email}> — ${u.bottles} bottles in`);
  }
  for (const e of db
    .prepare(
      `SELECT e.name, e.status,
              (SELECT COUNT(*) FROM event_menu m WHERE m.event_id = e.id) AS featured
         FROM event e ORDER BY e.name`,
    )
    .all()) {
    console.log(`     · ${e.name} (${e.status}) — ${e.featured || 'nothing'} featured`);
  }
  // `role` moved off this table when staff became per-party; reading it threw.
  for (const s of db.prepare(`SELECT display_name, status, joined_via FROM staff`).all()) {
    console.log(`     · ${s.display_name} (${s.joined_via}/${s.status})`);
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
