/**
 * The cupboard, and the menu generated from it.
 *
 * **What moved.** The cupboard used to hang off a party and be reachable only with a
 * bar session — which is why the screen for it ended up inside the bartender's
 * screen. It belongs to a *host* now, at `/api/hosts/[id]/stock`, and the guest menu
 * resolves party → host → cupboard. A host with three parties fills one list in.
 *
 * The agreement test below survives from the previous version and is the reason this
 * file exists at all: the host's view and the guest's are computed separately, and
 * they were once disagreeing about garnishes with nothing to catch it.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import {
  asAccount,
  asBar,
  barToken,
  helper as makeHelper,
  partyFor,
  person,
  useMemoryEmail,
  type Account,
} from './fixtures/people';

/** Everything a Margarita needs. `Shaken` is a method, so nobody stocks it. */
const MARGARITA = ['Tequila', 'Triple Sec', 'Lime Juice', 'Agave Syrup'];

interface StockBody {
  stockable: string[];
  stock: string[];
  recorded: boolean;
  makeable: { name: string }[];
  suggestions: { ingredient: string; unlocks: number }[];
}

interface MenuBody {
  available: Record<string, boolean>;
  makeable: { name: string }[];
}

let dan: Account;
let ana: Account;
let bruno: Account;
let anaParty = '';
let brunoParty = '';
let anaBar = '';

async function readStock(userId: string, headers: Record<string, string>): Promise<StockBody> {
  const res = await request(`/api/hosts/${userId}/stock`, { headers });
  assert.equal(res.status, 200);
  return (await res.json()) as StockBody;
}

const putStock = (userId: string, stock: string[], headers: Record<string, string>) =>
  request(`/api/hosts/${userId}/stock`, send('PUT', { stock }, headers));

/** The guest's view. No credential — that's the point of it. */
async function readMenu(eventId: string): Promise<MenuBody> {
  const res = await request(`/api/events/${eventId}/menu`);
  assert.equal(res.status, 200);
  return (await res.json()) as MenuBody;
}

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('stock-dan', 'admin');
  ana = await person('stock-ana');
  bruno = await person('stock-bruno');
  anaParty = partyFor(ana.id, "Ana's party");
  brunoParty = partyFor(bruno.id, "Bruno's party");
  anaBar = await barToken(dan, anaParty);
});

describe('ticking a cupboard', () => {
  test('an untouched cupboard pours nothing and says it was never asked', async () => {
    const { stock, makeable, recorded } = await readStock(bruno.id, asAccount(bruno));
    assert.deepEqual(stock, []);
    assert.deepEqual(makeable, []);
    assert.equal(recorded, false, 'nothing recorded is not the same as nothing in');
  });

  test('the tickable list is the whole cupboard, not just the ingredient table', async () => {
    const { stockable } = await readStock(bruno.id, asAccount(bruno));
    // 12 of the 25 bases never appear as an ingredient. Building the list from the
    // ingredients table alone would leave every drink built on them permanently
    // unmakeable with nothing to tick to fix it.
    assert.ok(stockable.includes('White Rum'), 'a base with no ingredients entry must be tickable');
    assert.ok(!stockable.includes('Shaken'), 'a method is not something you stock');
  });

  test('what you tick is what comes back', async () => {
    assert.equal((await putStock(ana.id, MARGARITA, asAccount(ana))).status, 200);
    const after = await readStock(ana.id, asAccount(ana));
    assert.deepEqual([...after.stock].sort(), [...MARGARITA].sort());
    assert.equal(after.recorded, true);
    assert.ok(
      after.makeable.some((r) => r.name === 'Margarita'),
      'tequila, triple sec, lime and agave is a Margarita',
    );
  });

  test('unticking is remembered, not merely forgotten', async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    await putStock(
      ana.id,
      MARGARITA.filter((i) => i !== 'Tequila'),
      asAccount(ana),
    );
    const after = await readStock(ana.id, asAccount(ana));
    assert.ok(!after.stock.includes('Tequila'));
    assert.equal(after.recorded, true, 'an emptied cupboard has still been answered');
    await putStock(ana.id, MARGARITA, asAccount(ana)); // put it back for the suites below
  });

  test('an ingredient we have never heard of is dropped, not rejected', async () => {
    const res = await putStock(
      ana.id,
      [...MARGARITA, 'Absolutely Not A Real Bottle'],
      asAccount(ana),
    );
    assert.equal(res.status, 200, 'a stale client should lose one tick, not its whole list');
    const { stock } = (await res.json()) as { stock: string[] };
    assert.deepEqual([...stock].sort(), [...MARGARITA].sort());
  });

  test('suggestions name the one bottle that would unlock the most', async () => {
    const { suggestions } = await readStock(ana.id, asAccount(ana));
    assert.ok(suggestions.length > 0, 'four bottles in, something must be one bottle away');
    assert.ok(
      suggestions.every((s) => s.unlocks > 0 && !MARGARITA.includes(s.ingredient)),
      'suggesting something already ticked would be noise',
    );
    const unlocks = suggestions.map((s) => s.unlocks);
    assert.deepEqual(
      unlocks,
      [...unlocks].sort((x, y) => y - x),
      'best first — the whole reason it is ordered',
    );
  });
});

describe('one cupboard, every party the host has', () => {
  test("a host's parties all read the same list", async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    const second = partyFor(ana.id, "Ana's other party");
    const first = await readMenu(anaParty);
    const other = await readMenu(second);
    assert.equal(first.available['Margarita'], true);
    assert.equal(
      other.available['Margarita'],
      true,
      'the cupboard follows the host, not the party',
    );
  });
});

describe('the guest menu follows the cupboard', () => {
  test('a party whose host has never opened it offers everything', async () => {
    // The default state of every new party. Gating on an empty cupboard would grey
    // out four of six drinks before the host had been asked a single question.
    const { available } = await readMenu(brunoParty);
    assert.deepEqual(Object.values(available), Array(6).fill(true));
  });

  test('but one tick turns the gating on for real', async () => {
    const fresh = await person('stock-ticker');
    const party = partyFor(fresh.id, 'Ticker party');
    await putStock(fresh.id, ['Gin'], asAccount(fresh));
    const { available } = await readMenu(party);
    assert.equal(available['Mojito'], false, 'a recorded cupboard gates from the first tick');
  });

  test('and emptying it is an answer, not a blank slate', async () => {
    const fresh = await person('stock-cleared');
    const party = partyFor(fresh.id, 'Cleared party');
    await putStock(fresh.id, ['Gin'], asAccount(fresh));
    await putStock(fresh.id, [], asAccount(fresh));
    const { available } = await readMenu(party);
    assert.equal(available['Mojito'], false);
    assert.equal(available['Wine'], true, 'a drink with no recipe is always pourable');
  });

  test('a drink with no recipe at all stays on the menu', async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    const { available } = await readMenu(anaParty);
    // Hiding these would mean refusing someone a glass of wine because our
    // ingredient table doesn't model wine — punishing a guest for a gap in our data.
    assert.equal(available['Wine'], true);
    assert.equal(available['Pom & Elderflower'], true);
  });

  test('every curated drink gets an answer', async () => {
    const { available } = await readMenu(anaParty);
    assert.equal(Object.keys(available).length, 6, 'a missing key would read as available');
  });
});

describe('the two screens agree', () => {
  test('the host and the guest count the same drinks', async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    const mine = await readStock(ana.id, asAccount(ana));
    const theirs = await readMenu(anaParty);
    assert.deepEqual(
      mine.makeable.map((r) => r.name).sort(),
      theirs.makeable.map((r) => r.name).sort(),
      'the host and the guest must not be looking at different drinks',
    );
  });

  test('and both let a missing garnish slide', async () => {
    // A Dry Martini is gin, dry vermouth and an olive. The olive is a `finish`, and
    // neither screen should hold it against the drink — the exact case the two
    // endpoints used to answer differently.
    await putStock(ana.id, ['Gin', 'Dry Vermouth'], asAccount(ana));
    const mine = await readStock(ana.id, asAccount(ana));
    const theirs = await readMenu(anaParty);
    assert.ok(
      mine.makeable.some((r) => r.name === 'Dry Martini'),
      'the host has no olives, but a Martini is still a Martini',
    );
    assert.deepEqual(
      mine.makeable.map((r) => r.name).sort(),
      theirs.makeable.map((r) => r.name).sort(),
    );
    await putStock(ana.id, MARGARITA, asAccount(ana));
  });
});

describe('whose cupboard it is', () => {
  test('the host owns theirs', async () => {
    assert.equal((await putStock(ana.id, MARGARITA, asAccount(ana))).status, 200);
  });

  test('Admin can fill one in for them', async () => {
    // The "do the chore for them" case: Dan arrives, the host has ticked nothing.
    const res = await putStock(ana.id, [...MARGARITA, 'Gin'], asAccount(dan));
    assert.equal(res.status, 200);
    await putStock(ana.id, MARGARITA, asAccount(ana));
  });

  test('another host cannot see it, let alone change it', async () => {
    // 404 rather than 403: an id must not become a way to discover who exists.
    assert.equal(
      (await request(`/api/hosts/${ana.id}/stock`, { headers: asAccount(bruno) })).status,
      404,
    );
    assert.equal((await putStock(ana.id, ['Gin'], asAccount(bruno))).status, 404);
  });

  test('a bar session is not a way in — that was the whole bug', async () => {
    // Someone holding a bar session at Ana's party still cannot touch her cupboard
    // unless they *are* her or an admin. The old model had no way to say that.
    const barHelper = await makeHelper(dan, anaParty, 'Helper', 'dev-stock-helper');
    assert.equal(
      (await request(`/api/hosts/${ana.id}/stock`, { headers: asBar(barHelper) })).status,
      404,
    );
    assert.equal((await putStock(ana.id, ['Gin'], asBar(barHelper))).status, 404);
  });

  test('a stranger gets nothing', async () => {
    assert.equal((await request(`/api/hosts/${ana.id}/stock`)).status, 401);
    assert.equal(
      (await request(`/api/hosts/${ana.id}/stock`, send('PUT', { stock: [] }))).status,
      401,
    );
  });

  test('and the bar session still works for the bar', async () => {
    assert.equal((await request('/api/orders', { headers: asBar(anaBar) })).status, 200);
  });
});

describe('one party per menu', () => {
  test("one host's cupboard never reaches another's menu", async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    await putStock(bruno.id, ['Gin', 'Dry Vermouth'], asAccount(bruno));

    const hers = await readMenu(anaParty);
    const his = await readMenu(brunoParty);
    assert.equal(hers.available['Margarita'], true);
    assert.equal(his.available['Margarita'], false, "bruno has no tequila — ana's is not his");
  });

  test('a party that does not exist has no menu', async () => {
    assert.equal((await request('/api/events/not-a-party/menu')).status, 404);
  });
});
