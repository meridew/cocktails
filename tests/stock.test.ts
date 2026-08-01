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
import type { Order } from '$lib/shared';
import {
  admittedDevice,
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
  event: { id: string; name: string };
  /** Where the list came from — the cupboard, or the six house drinks. */
  source: 'cupboard' | 'house';
  recorded: boolean;
  items: { id: string; name: string; base: string }[];
  shortList: string[];
  stock: string[];
}

/** Just the names, which is what nearly every assertion here wants. */
const names = (m: MenuBody): string[] => m.items.map((i) => i.name);

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
    assert.ok(names(await readMenu(anaParty)).includes('Margarita'));
    assert.ok(
      names(await readMenu(second)).includes('Margarita'),
      'the cupboard follows the host, not the party',
    );
  });
});

describe('the menu is generated, not filtered', () => {
  test('a stocked Strawberry Daiquiri reaches the guest menu', async () => {
    const host = await person('stock-strawberry-daiquiri');
    const party = partyFor(host.id, 'Strawberry party');
    const stock = ['White Rum', 'Lime Juice', 'Simple Syrup', 'Strawberry Purée'];

    assert.equal((await putStock(host.id, stock, asAccount(host))).status, 200);
    assert.ok(names(await readMenu(party)).includes('Strawberry Daiquiri'));
  });

  test('the server snapshots its recipe, not instructions supplied by a guest', async () => {
    const host = await person('stock-strawberry-guide');
    const party = partyFor(host.id, 'Guided strawberry party');
    const stock = ['White Rum', 'Lime Juice', 'Simple Syrup', 'Strawberry Purée'];
    await putStock(host.id, stock, asAccount(host));

    const created = await request(
      '/api/orders',
      send('POST', {
        eventId: party,
        deviceId: admittedDevice(party, 'strawberry-guide'),
        name: 'Ada',
        items: [
          {
            name: 'Strawberry Daiquiri',
            qty: 1,
            guide: { ingredients: [], steps: ['Use the guest instructions'] },
          },
        ],
      }),
    );
    assert.equal(created.status, 200);

    const listed = await request(`/api/orders?eventId=${party}`, { headers: asAccount(host) });
    assert.equal(listed.status, 200);
    const [order] = ((await listed.json()) as { orders: Order[] }).orders;
    assert.ok(order?.items[0]?.guide);
    assert.equal(order.items[0].guide.ingredients[0]?.amount, '50 ml');
    assert.ok(!order.items[0].guide.steps.some((step) => step.includes('guest instructions')));
  });

  test('a sugar-free Monster tick puts Gin & Monster on the guest menu', async () => {
    const host = await person('stock-monster');
    const party = partyFor(host.id, 'Monster party');
    const mixer = 'Monster Ultra (Zero Sugar)';

    assert.equal((await putStock(host.id, ['Gin', mixer], asAccount(host))).status, 200);
    const cupboard = await readStock(host.id, asAccount(host));
    assert.ok(cupboard.stockable.includes(mixer));
    assert.ok(cupboard.makeable.some((r) => r.name === 'Gin & Monster'));
    assert.ok(names(await readMenu(party)).includes('Gin & Monster'));
  });

  test('four bottles yield more than the four drinks we happened to curate', async () => {
    // The promise phase 5 exists to keep. This used to answer "which of the six
    // house drinks can we pour", so a host with a real bar still saw six.
    await putStock(ana.id, MARGARITA, asAccount(ana));
    const menu = await readMenu(anaParty);
    assert.equal(menu.source, 'cupboard');
    assert.ok(names(menu).includes('Margarita'));
    assert.ok(
      menu.items.every((i) => i.base && i.id),
      'every item carries what the guest screen groups and keys by',
    );
  });

  test('a party whose host has never opened the cupboard gets the house list', async () => {
    // Not an empty menu: a host who has answered nothing has not said "nothing".
    // Six curated drinks is a working party, and it is what the app served before
    // any of this existed.
    const menu = await readMenu(brunoParty);
    assert.equal(menu.source, 'house');
    assert.equal(menu.recorded, false);
    assert.equal(menu.items.length, 6);
    assert.ok(
      names(menu).includes('Wine'),
      'the house list keeps the drinks we have no recipe for',
    );
  });

  test('but one tick switches it to the real thing', async () => {
    const fresh = await person('stock-ticker');
    const party = partyFor(fresh.id, 'Ticker party');
    await putStock(fresh.id, ['Gin'], asAccount(fresh));
    const menu = await readMenu(party);
    assert.equal(menu.source, 'cupboard');
    assert.ok(!names(menu).includes('Mojito'), 'gin alone is not a Mojito');
  });

  test('and emptying it is an answer, not a blank slate', async () => {
    // The distinction the `false` rows exist to preserve: an untouched cupboard
    // falls back to the house list, a deliberately emptied one does not.
    const fresh = await person('stock-cleared');
    const party = partyFor(fresh.id, 'Cleared party');
    await putStock(fresh.id, ['Gin'], asAccount(fresh));
    await putStock(fresh.id, [], asAccount(fresh));
    const menu = await readMenu(party);
    assert.equal(menu.recorded, true, 'an emptied cupboard has still been answered');
    assert.equal(menu.source, 'cupboard');
    assert.deepEqual(menu.items, [], 'nothing in means nothing on');
  });

  test('the stock ships too, so the walk can run in the browser', async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    const menu = await readMenu(anaParty);
    assert.deepEqual([...menu.stock].sort(), [...MARGARITA].sort());
  });
});

describe('the two screens agree', () => {
  test('the host and the guest count the same drinks', async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    const mine = await readStock(ana.id, asAccount(ana));
    const theirs = await readMenu(anaParty);
    assert.deepEqual(
      mine.makeable.map((r) => r.name).sort(),
      names(theirs).sort(),
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
    assert.deepEqual(mine.makeable.map((r) => r.name).sort(), names(theirs).sort());
    await putStock(ana.id, MARGARITA, asAccount(ana));
  });
});

describe('the short list', () => {
  const curate = (eventId: string, recipes: string[], headers: Record<string, string>) =>
    request(`/api/events/${eventId}/menu`, send('PUT', { recipes }, headers));

  test('nothing curated means show everything, not show nothing', async () => {
    // The default state of every party. An empty list must read as "we did not pick
    // favourites", never as a broken menu.
    await putStock(ana.id, MARGARITA, asAccount(ana));
    assert.deepEqual((await readMenu(anaParty)).shortList, []);
  });

  test('a host curates their own party', async () => {
    const res = await curate(anaParty, ['margarita'], asAccount(ana));
    assert.equal(res.status, 200);
    assert.deepEqual((await readMenu(anaParty)).shortList, ['margarita']);
  });

  test('ids that are not on the menu are dropped, not refused', async () => {
    // A host curates, then takes the tequila out. They should lose that one entry,
    // not have the whole list refused — and the guest screen must never be handed an
    // id it has no item for.
    await curate(anaParty, ['margarita'], asAccount(ana));
    await putStock(ana.id, ['Gin', 'Dry Vermouth'], asAccount(ana));
    const menu = await readMenu(anaParty);
    assert.deepEqual(menu.shortList, [], 'no tequila, no margarita to feature');
    await putStock(ana.id, MARGARITA, asAccount(ana));
    assert.deepEqual((await readMenu(anaParty)).shortList, ['margarita'], 'and it comes back');
  });

  test('a name we have never heard of is dropped at the door', async () => {
    const res = await curate(anaParty, ['margarita', 'not-a-drink'], asAccount(ana));
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { shortList: string[] }).shortList, ['margarita']);
  });

  test('emptying it is allowed — curation is optional in both directions', async () => {
    assert.equal((await curate(anaParty, [], asAccount(ana))).status, 200);
    assert.deepEqual((await readMenu(anaParty)).shortList, []);
  });

  test('a stale basket cannot order around the current short list', async () => {
    await putStock(ana.id, MARGARITA, asAccount(ana));
    await curate(anaParty, ['margarita'], asAccount(ana));
    const excluded = (await readMenu(anaParty)).items.find((item) => item.id !== 'margarita');
    assert.ok(excluded, 'the cupboard should make another drink to exclude');

    const res = await request(
      '/api/orders',
      send('POST', {
        eventId: anaParty,
        deviceId: admittedDevice(anaParty, 'stale-menu'),
        name: 'Stale guest',
        items: [{ name: excluded.name, qty: 1 }],
      }),
    );
    assert.equal(res.status, 422);
    assert.match(((await res.json()) as { error: string }).error, /not on this party's menu/i);
    await curate(anaParty, [], asAccount(ana));
  });

  test('Admin curates for a host who would rather not', async () => {
    assert.equal((await curate(anaParty, ['margarita'], asAccount(dan))).status, 200);
    await curate(anaParty, [], asAccount(dan));
  });

  test('another host cannot touch it', async () => {
    // 404 rather than 403, so the id does not confirm the party is real.
    assert.equal((await curate(anaParty, ['margarita'], asAccount(bruno))).status, 404);
  });

  test('a helper behind the bar cannot either — pouring is not choosing', async () => {
    const barHelper = await makeHelper(dan, anaParty, 'Curator', 'dev-curate-helper');
    assert.equal((await curate(anaParty, ['margarita'], asBar(barHelper))).status, 403);
  });

  test('and a guest certainly cannot', async () => {
    assert.equal((await curate(anaParty, ['margarita'], {})).status, 401);
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

    assert.ok(names(await readMenu(anaParty)).includes('Margarita'));
    assert.ok(
      !names(await readMenu(brunoParty)).includes('Margarita'),
      "bruno has no tequila — ana's is not his",
    );
  });

  test('a party that does not exist has no menu', async () => {
    assert.equal((await request('/api/events/not-a-party/menu')).status, 404);
  });
});
