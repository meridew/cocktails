/**
 * The recipe engine, checked against recipes anyone can verify by eye.
 *
 * The port had two traps in it, and both are asserted here rather than described:
 *
 *   1. `reachable()` and `makeable()` run in opposite directions. The plan said the
 *      cupboard was "one reachable() call with the stock as the picked set"; that
 *      returns recipes *containing* the stock rather than recipes *satisfied by* it,
 *      which with a small cupboard yields the elaborate drinks instead of the simple
 *      ones — wrong in a way that reads as merely odd.
 *   2. Twelve of the twenty-five base spirits are absent from the ingredient table,
 *      so anything keyed on that table alone silently makes them unorderable.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import {
  BASES,
  CATEGORY_ORDER,
  INGREDIENTS,
  RECIPES,
  STOCKABLE,
  categoryOf,
  countWith,
  exactMatch,
  availability,
  makeable,
  reachable,
  suggestions,
} from '$lib/shared/recipes';

/** A drink most people can check from memory. */
const NEGRONI = { base: 'Gin', needs: ['Campari', 'Sweet Vermouth'], method: 'Stirred' };

describe('the data itself', () => {
  test('270 recipes and the eleven-step category order survived the port', () => {
    assert.equal(RECIPES.length, 270);
    assert.deepEqual(CATEGORY_ORDER, [
      'liquor',
      'citrus',
      'juice',
      'sweetener',
      'bitters',
      'texture',
      'herb',
      'top',
      'aromatic',
      'finish',
      'method',
    ]);
  });

  test('every ingredient a recipe names is in the ingredient table', () => {
    const orphans = RECIPES.flatMap((r) => r.ingredients).filter((i) => !(i in INGREDIENTS));
    assert.deepEqual([...new Set(orphans)], [], 'a recipe needs something uncategorised');
  });

  test('every recipe id is unique', () => {
    assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  });

  test('bases that the ingredient table does not know are still stockable', () => {
    // The trap: White Rum, Sherry, Aquavit and nine others appear only as a `base`.
    // A stock list built from INGREDIENTS alone leaves them permanently unmakeable
    // with nothing to tick to fix it.
    const unlisted = BASES.filter((b) => !(b in INGREDIENTS));
    assert.ok(unlisted.length > 0, 'this test is pointless if every base is listed');
    for (const b of unlisted) {
      assert.ok(STOCKABLE.includes(b), `${b} is a base nobody could ever say they had`);
    }
  });

  test('build methods are not stockable', () => {
    for (const method of ['Shaken', 'Stirred', 'Built']) {
      assert.equal(categoryOf(method), 'method');
      assert.ok(!STOCKABLE.includes(method), `${method} is a technique, not a bottle`);
    }
  });
});

describe('reachable — the interactive walk', () => {
  test('nothing is reachable before a base is chosen', () => {
    assert.deepEqual(reachable({ base: null, picked: [], skipped: [] }), []);
  });

  test('a base alone reaches every recipe built on it', () => {
    const gins = reachable({ base: 'Gin', picked: [], skipped: [] });
    assert.ok(gins.length > 1);
    assert.ok(gins.every((r) => r.base === 'Gin'));
    assert.ok(gins.some((r) => r.name === 'Negroni'));
  });

  test('picks narrow it to recipes that contain them all', () => {
    const found = reachable({ base: NEGRONI.base, picked: NEGRONI.needs, skipped: [] });
    assert.ok(
      found.some((r) => r.name === 'Negroni'),
      'Gin + Campari + Sweet Vermouth must still reach a Negroni',
    );
    assert.ok(found.every((r) => r.ingredients.includes('Campari')));
  });

  test('skipping a category drops recipes that need it', () => {
    const withCitrus = reachable({ base: 'Gin', picked: [], skipped: [] });
    const without = reachable({ base: 'Gin', picked: [], skipped: ['citrus'] });
    assert.ok(without.length < withCitrus.length, 'skipping citrus should remove something');
    for (const r of without) {
      assert.ok(
        !r.ingredients.some((i) => categoryOf(i) === 'citrus'),
        `${r.name} still needs citrus`,
      );
    }
  });

  test('ingredients already picked survive their category being skipped', () => {
    // This is what lets the walk ask "anything *else* from this category?" and take
    // no for an answer without throwing away the yeses it already has.
    //
    // Both of a Negroni's liquors have to be picked for it to survive `skipped:
    // ['liquor']` — with only Campari chosen it is correctly dropped, because it
    // still needs a second liquor the guest just declined.
    const bothLiquors = reachable({
      base: NEGRONI.base,
      picked: NEGRONI.needs,
      skipped: ['liquor'],
    });
    assert.ok(
      bothLiquors.some((r) => r.name === 'Negroni'),
      'declining *more* liquor must not discard the liquors already chosen',
    );

    const onlyOne = reachable({ base: NEGRONI.base, picked: ['Campari'], skipped: ['liquor'] });
    assert.ok(
      !onlyOne.some((r) => r.name === 'Negroni'),
      'a recipe still needing a declined category must go',
    );
  });

  test('exactMatch fires only when the picks are the whole recipe', () => {
    const partial = reachable({ base: NEGRONI.base, picked: NEGRONI.needs, skipped: [] });
    assert.equal(exactMatch(partial, NEGRONI.needs), null, 'the method is still missing');

    const complete = [...NEGRONI.needs, NEGRONI.method];
    const full = reachable({ base: NEGRONI.base, picked: complete, skipped: [] });
    assert.equal(exactMatch(full, complete)?.name, 'Negroni');
  });

  test('countWith counts survivors, not recipes overall', () => {
    const gins = reachable({ base: 'Gin', picked: [], skipped: [] });
    assert.equal(
      countWith(gins, 'Campari'),
      gins.filter((r) => r.ingredients.includes('Campari')).length,
    );
  });
});

describe('makeable — the host’s cupboard', () => {
  test('a cupboard holding exactly a Negroni produces one', () => {
    const stock = [NEGRONI.base, ...NEGRONI.needs];
    const can = makeable(stock);
    assert.ok(
      can.some((r) => r.name === 'Negroni'),
      'Gin, Campari and Sweet Vermouth is a Negroni — the method is not a bottle',
    );
    for (const r of can) {
      assert.ok(stock.includes(r.base));
    }
  });

  test('an empty cupboard makes nothing', () => {
    assert.deepEqual(makeable([]), []);
  });

  test('having the mixers but not the spirit makes nothing', () => {
    assert.deepEqual(makeable(NEGRONI.needs), [], 'the base is the drink');
  });

  test('every result is genuinely satisfied by the stock', () => {
    const stock = ['Gin', 'Vodka', 'Campari', 'Sweet Vermouth', 'Lime Juice', 'Simple Syrup'];
    for (const r of makeable(stock)) {
      for (const i of r.ingredients) {
        if (categoryOf(i) === 'method') continue;
        assert.ok(stock.includes(i), `${r.name} needs ${i}, which isn't in stock`);
      }
    }
  });

  test('ignoring garnishes widens the list rather than narrowing it', () => {
    const stock = ['Gin', 'Vodka', 'Dry Vermouth', 'Campari', 'Sweet Vermouth'];
    const strict = makeable(stock);
    const relaxed = makeable(stock, { ignore: ['finish'] });
    assert.ok(relaxed.length >= strict.length);
    assert.ok(
      relaxed.every((r) => r.base === 'Gin' || r.base === 'Vodka'),
      'relaxing garnishes must not relax the spirit',
    );
  });

  test('a base the ingredient table has never heard of still works', () => {
    const unlisted = BASES.find((b) => !(b in INGREDIENTS));
    assert.ok(unlisted, 'no unlisted base to test with');
    const recipe = RECIPES.find((r) => r.base === unlisted);
    assert.ok(recipe, `no recipe uses ${unlisted}`);
    const stock = [recipe.base, ...recipe.ingredients.filter((i) => categoryOf(i) !== 'method')];
    assert.ok(
      makeable(stock).some((r) => r.id === recipe.id),
      `${recipe.name} is unmakeable because its base isn't in the ingredient table`,
    );
  });
});

describe('the two predicates are not the same one', () => {
  test('reachable offers drinks the cupboard cannot actually make', () => {
    // The plan's shortcut, run for real. A cupboard of gin and Campari:
    //   reachable(picked: ['Campari']) → Negroni and Jasmine, because both
    //                                    *contain* Campari
    //   makeable(['Gin', 'Campari'])   → nothing: one needs Sweet Vermouth, the
    //                                    other Triple Sec and lemon
    // Had the cupboard screen used reachable, it would have listed two drinks that
    // cannot be poured — wrong in a way that reads as merely generous.
    const stock = ['Gin', 'Campari'];

    const asIfPicked = reachable({ base: 'Gin', picked: ['Campari'], skipped: [] });
    const fromCupboard = makeable(stock);

    assert.ok(asIfPicked.length > 0, 'reachable should offer something');
    assert.deepEqual(fromCupboard, [], 'gin and Campari alone pour nothing');

    for (const r of asIfPicked) {
      const missing = r.ingredients.filter((i) => categoryOf(i) !== 'method' && !stock.includes(i));
      assert.ok(missing.length > 0, `${r.name} should need something the stock lacks`);
    }
  });

  test('and the definitional property holds either way round', () => {
    const stock = ['Gin', 'Campari', 'Sweet Vermouth', 'Lime Juice', 'Simple Syrup'];
    // makeable: recipe ⊆ stock
    for (const r of makeable(stock)) {
      for (const i of r.ingredients) {
        if (categoryOf(i) === 'method') continue;
        assert.ok(stock.includes(i), `makeable returned ${r.name}, which needs ${i}`);
      }
    }
    // reachable: picked ⊆ recipe
    const picked = ['Campari', 'Sweet Vermouth'];
    for (const r of reachable({ base: 'Gin', picked, skipped: [] })) {
      for (const p of picked) {
        assert.ok(r.ingredients.includes(p), `reachable returned ${r.name}, which lacks ${p}`);
      }
    }
  });
});

describe('suggestions — what one more bottle would unlock', () => {
  test('names only ingredients that are the single thing missing', () => {
    const stock = ['Gin', 'Lime Juice'];
    const out = suggestions(stock);
    assert.ok(out.length > 0);
    for (const { ingredient } of out) {
      assert.ok(!stock.includes(ingredient), 'suggesting something already in stock');
    }
  });

  test('each count is real: adding the top suggestion unlocks that many drinks', () => {
    const stock = ['Gin', 'Lime Juice'];
    const before = makeable(stock).length;
    const top = suggestions(stock)[0];
    assert.ok(top);
    const after = makeable([...stock, top.ingredient]).length;
    assert.equal(
      after - before,
      top.unlocks,
      `adding ${top.ingredient} did not unlock ${top.unlocks}`,
    );
  });

  test('sorted by how much they unlock', () => {
    const out = suggestions(['Vodka']);
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1]!.unlocks >= out[i]!.unlocks, 'suggestions are out of order');
    }
  });
});

describe('availability — gating the curated menu', () => {
  test('a curated drink the stock can pour is available', () => {
    // Margarita: Tequila + Triple Sec + Lime Juice + Agave Syrup (Shaken is a method).
    const stock = ['Tequila', 'Triple Sec', 'Lime Juice', 'Agave Syrup'];
    assert.equal(availability(stock, ['Margarita'])['Margarita'], true);
  });

  test('and one it cannot is not', () => {
    assert.equal(availability(['Tequila'], ['Margarita'])['Margarita'], false);
  });

  test('a drink with no recipe at all stays available', () => {
    // Wine and Pom & Elderflower are on the curated menu and in no recipe. Hiding
    // them would mean telling a guest they can't have wine because our ingredient
    // table doesn't model wine — punishing them for a gap in our data.
    const out = availability([], ['Wine', 'Pom & Elderflower']);
    assert.equal(out['Wine'], true);
    assert.equal(out['Pom & Elderflower'], true);
  });

  test('an empty cupboard hides only what we can actually reason about', () => {
    const out = availability([], ['Margarita', 'Mojito', 'Wine']);
    assert.deepEqual(out, { Margarita: false, Mojito: false, Wine: true });
  });

  test('matching ignores case, because the two lists were written separately', () => {
    const stock = ['Tequila', 'Triple Sec', 'Lime Juice', 'Agave Syrup'];
    assert.equal(availability(stock, ['MARGARITA'])['MARGARITA'], true);
  });
});
