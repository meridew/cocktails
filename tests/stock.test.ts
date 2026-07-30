/**
 * The stock loop: a host ticks what they've got in, and the guest menu changes.
 *
 * This is phase 3's gate, and it is written across *both* endpoints on purpose.
 * `GET /api/inventory` (the host's screen) and `GET /api/events/[id]/menu` (the
 * guest's) each decide independently what tonight can pour, and they were already
 * disagreeing before anything rendered them: the first called `makeable(stock)` with
 * no options while the second passed `{ ignore: ['finish'] }`, so a Dry Martini
 * counted at the bar and not on the menu. Nothing would have failed — the numbers
 * would just have been different, on two screens nobody looks at side by side.
 *
 * Hence the agreement test below. The shared constant is the fix; this is what stops
 * it drifting apart again.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { hashPassword } from '$lib/server/auth';
import { createEvent, createStaff, genId } from '$lib/server/db';

interface Bar {
  eventId: string;
  /** The host: `inventory:edit`. */
  admin: string;
  /** A helper: `inventory:read` only. */
  helper: string;
}

/** Everything a Margarita needs. `Shaken` is a method, so nobody stocks it. */
const MARGARITA = ['Tequila', 'Triple Sec', 'Lime Juice', 'Agave Syrup'];

async function signIn(email: string, password: string): Promise<string> {
  const res = await request('/api/auth/login', send('POST', { email, password }));
  assert.equal(res.status, 200, `${email} should be able to sign in`);
  return ((await res.json()) as { token: string }).token;
}

/** A party with a host and one helper, both signed in. */
async function bar(label: string): Promise<Bar> {
  const event = createEvent({ name: `${label}'s party` });
  const password = `${label}-password`;

  for (const role of ['admin', 'bartender'] as const) {
    createStaff({
      id: genId(),
      eventId: event.id,
      displayName: `${label} ${role}`,
      email: `${label}-${role}@example.com`,
      passwordHash: await hashPassword(password),
      role,
      status: 'active',
    });
  }

  return {
    eventId: event.id,
    admin: await signIn(`${label}-admin@example.com`, password),
    helper: await signIn(`${label}-bartender@example.com`, password),
  };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

interface StockBody {
  stockable: string[];
  stock: string[];
  makeable: { name: string }[];
  suggestions: { ingredient: string; unlocks: number }[];
}

async function readStock(token: string): Promise<StockBody> {
  const res = await request('/api/inventory', { headers: as(token) });
  assert.equal(res.status, 200);
  return (await res.json()) as StockBody;
}

async function putStock(token: string, stock: string[]): Promise<Response> {
  return request('/api/inventory', send('PUT', { stock }, as(token)));
}

interface MenuBody {
  available: Record<string, boolean>;
  makeable: { name: string }[];
}

/** The guest's view. No credential — that's the point of it. */
async function readMenu(eventId: string): Promise<MenuBody> {
  const res = await request(`/api/events/${eventId}/menu`);
  assert.equal(res.status, 200);
  return (await res.json()) as MenuBody;
}

let ana: Bar;
let bruno: Bar;

beforeAll(async () => {
  ana = await bar('stock-ana');
  bruno = await bar('stock-bruno');
});

describe('ticking a cupboard', () => {
  test('an empty cupboard pours nothing', async () => {
    const { stock, makeable } = await readStock(bruno.admin);
    assert.deepEqual(stock, []);
    assert.deepEqual(makeable, []);
  });

  test('the tickable list is the whole cupboard, not just the ingredient table', async () => {
    const { stockable } = await readStock(bruno.admin);
    // 12 of the 25 bases never appear as an ingredient. Building the list from the
    // ingredients table alone would leave every drink built on them permanently
    // unmakeable with nothing to tick to fix it.
    assert.ok(stockable.includes('White Rum'), 'a base with no ingredients entry must be tickable');
    assert.ok(!stockable.includes('Shaken'), 'a method is not something you stock');
  });

  test('what you tick is what comes back', async () => {
    const put = await putStock(ana.admin, MARGARITA);
    assert.equal(put.status, 200);
    const after = await readStock(ana.admin);
    assert.deepEqual([...after.stock].sort(), [...MARGARITA].sort());
    assert.ok(
      after.makeable.some((r) => r.name === 'Margarita'),
      'tequila, triple sec, lime and agave is a Margarita',
    );
  });

  test('unticking is remembered, not merely forgotten', async () => {
    await putStock(ana.admin, MARGARITA);
    await putStock(
      ana.admin,
      MARGARITA.filter((i) => i !== 'Tequila'),
    );
    const after = await readStock(ana.admin);
    assert.ok(!after.stock.includes('Tequila'));
    assert.ok(!after.makeable.some((r) => r.name === 'Margarita'));
    await putStock(ana.admin, MARGARITA); // put it back for the suites below
  });

  test('an ingredient we have never heard of is dropped, not rejected', async () => {
    const res = await putStock(ana.admin, [...MARGARITA, 'Absolutely Not A Real Bottle']);
    assert.equal(res.status, 200, 'a stale client should lose one tick, not its whole list');
    const { stock } = (await res.json()) as { stock: string[] };
    assert.deepEqual([...stock].sort(), [...MARGARITA].sort());
  });

  test('suggestions name the one bottle that would unlock the most', async () => {
    const { suggestions } = await readStock(ana.admin);
    assert.ok(suggestions.length > 0, 'four bottles in, something must be one bottle away');
    assert.ok(
      suggestions.every((s) => s.unlocks > 0 && !MARGARITA.includes(s.ingredient)),
      'suggesting something already ticked would be noise',
    );
    // Best first — the whole reason the list is ordered at all.
    const unlocks = suggestions.map((s) => s.unlocks);
    assert.deepEqual(
      unlocks,
      [...unlocks].sort((x, y) => y - x),
    );
  });
});

describe('the guest menu follows the stock', () => {
  test('a party whose host has never opened the stock screen offers everything', async () => {
    // The default state of every new party. Gating on an empty cupboard would grey
    // out four of the six drinks before the host has been asked a single question,
    // which is the app looking broken at the exact moment someone decides whether to
    // trust it. "Never asked" is not "asked and answered no".
    const fresh = await bar('stock-fresh');
    const { available } = await readMenu(fresh.eventId);
    assert.deepEqual(Object.values(available), Array(6).fill(true));
  });

  test('but one tick turns the gating on for real', async () => {
    const fresh = await bar('stock-ticker');
    await putStock(fresh.admin, ['Gin']);
    const { available } = await readMenu(fresh.eventId);
    assert.equal(available['Mojito'], false, 'a recorded cupboard gates from the first tick');
  });

  test('and unticking everything is an answer, not a blank slate', async () => {
    // The PUT writes `false` rows rather than deleting them precisely so this case
    // is distinguishable from the one above. If it ever starts deleting, a host who
    // clears the list gets the full menu back and nothing says so.
    const fresh = await bar('stock-cleared');
    await putStock(fresh.admin, ['Gin']);
    await putStock(fresh.admin, []);
    const { available } = await readMenu(fresh.eventId);
    assert.equal(available['Mojito'], false);
    assert.equal(available['Wine'], true, 'a drink with no recipe is always pourable');
  });

  test('a drink the host can pour is offered', async () => {
    await putStock(ana.admin, MARGARITA);
    const { available } = await readMenu(ana.eventId);
    assert.equal(available['Margarita'], true);
  });

  test('a drink they cannot is marked unavailable', async () => {
    await putStock(ana.admin, MARGARITA);
    const { available } = await readMenu(ana.eventId);
    assert.equal(available['Mojito'], false, 'no white rum, no Mojito');
  });

  test('a drink with no recipe at all stays on the menu', async () => {
    await putStock(ana.admin, MARGARITA);
    const { available } = await readMenu(ana.eventId);
    // Wine and Pom & Elderflower have no entry among the 270. Hiding them would mean
    // refusing someone a glass of wine because our ingredient table doesn't model
    // wine — punishing a guest for a gap in our data.
    assert.equal(available['Wine'], true);
    assert.equal(available['Pom & Elderflower'], true);
  });

  test('every curated drink gets an answer', async () => {
    const { available } = await readMenu(ana.eventId);
    assert.equal(Object.keys(available).length, 6, 'a missing key would read as available');
  });
});

describe('the two screens agree', () => {
  test('the bar and the guest menu count the same drinks', async () => {
    await putStock(ana.admin, MARGARITA);
    const mine = await readStock(ana.admin);
    const theirs = await readMenu(ana.eventId);
    assert.deepEqual(
      mine.makeable.map((r) => r.name).sort(),
      theirs.makeable.map((r) => r.name).sort(),
      'the host and the guest must not be looking at different drinks',
    );
  });

  test('and both let a missing garnish slide', async () => {
    // A Dry Martini is gin, dry vermouth and an olive. The olive is a `finish`, and
    // neither screen should hold it against the drink — this is the exact case the
    // two endpoints used to answer differently.
    await putStock(ana.admin, ['Gin', 'Dry Vermouth']);
    const mine = await readStock(ana.admin);
    const theirs = await readMenu(ana.eventId);
    assert.ok(
      mine.makeable.some((r) => r.name === 'Dry Martini'),
      'the host has no olives, but a Martini is still a Martini',
    );
    assert.deepEqual(
      mine.makeable.map((r) => r.name).sort(),
      theirs.makeable.map((r) => r.name).sort(),
    );
  });
});

describe('who may change it', () => {
  test('a helper can read the stock list', async () => {
    const res = await request('/api/inventory', { headers: as(ana.helper) });
    assert.equal(res.status, 200, '"have we got any gin left?" is most of the job');
  });

  test('but not change it', async () => {
    const res = await putStock(ana.helper, ['Gin']);
    assert.equal(res.status, 403);
  });

  test('and a stranger can do neither', async () => {
    assert.equal((await request('/api/inventory')).status, 401);
    assert.equal((await request('/api/inventory', send('PUT', { stock: [] }))).status, 401);
  });
});

describe('one cupboard per party', () => {
  test("a host's stock never reaches another host's bar", async () => {
    await putStock(ana.admin, MARGARITA);
    await putStock(bruno.admin, ['Gin', 'Dry Vermouth']);

    const hers = await readStock(ana.admin);
    const his = await readStock(bruno.admin);
    assert.ok(!hers.stock.includes('Gin'), "ana's cupboard contained bruno's gin");
    assert.ok(!his.stock.includes('Tequila'), "bruno's cupboard contained ana's tequila");
  });

  test('nor another party’s menu', async () => {
    const hers = await readMenu(ana.eventId);
    const his = await readMenu(bruno.eventId);
    assert.equal(hers.available['Margarita'], true);
    assert.equal(his.available['Margarita'], false, "bruno has no tequila — ana's is not his");
  });

  test('a party that does not exist has no menu', async () => {
    const res = await request('/api/events/not-a-party/menu');
    assert.equal(res.status, 404);
  });
});
