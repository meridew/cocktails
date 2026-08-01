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
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  INGREDIENTS,
  OPTIONAL_CATEGORIES,
  RECIPES,
  SHELF_LABELS,
  STOCKABLE,
  STOCK_GROUPS,
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
  test('287 recipes and the eleven-step category order survived the port', () => {
    // 270 came over from the legacy app; the other 17 are later additions for
    // drinks a real party cupboard implies, which the ported set lacked.
    assert.equal(RECIPES.length, 287);
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

  test('Monster Ultra is a stockable mixer', () => {
    assert.equal(categoryOf('Monster Ultra (Zero Sugar)'), 'top');
    assert.ok(STOCKABLE.includes('Monster Ultra (Zero Sugar)'));
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
  test('gin and Monster make a Gin & Monster', () => {
    const stock = ['Gin', 'Monster Ultra (Zero Sugar)'];
    assert.ok(makeable(stock).some((r) => r.name === 'Gin & Monster'));
    assert.ok(!makeable(['Gin']).some((r) => r.name === 'Gin & Monster'));
  });

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

describe('the shape the stock screen needs', () => {
  test('every tickable ingredient lands in exactly one group', () => {
    const grouped = STOCK_GROUPS.flatMap((g) => g.items);
    assert.deepEqual([...grouped].sort(), [...STOCKABLE].sort());
    assert.equal(new Set(grouped).size, grouped.length, 'an ingredient appeared twice');
  });

  test('the bases with no ingredients entry are filed under spirits', () => {
    const liquor = STOCK_GROUPS.find((g) => g.category === 'liquor');
    assert.ok(liquor);
    // White Rum is a `base` and nothing else. Left ungrouped it would be untickable,
    // which would make every rum drink permanently unmakeable.
    assert.ok(!INGREDIENTS['White Rum'], 'this test is pointless if the data changed');
    assert.ok(liquor.items.includes('White Rum'));
  });

  test('nothing you cannot stock has a shelf', () => {
    assert.ok(!STOCK_GROUPS.some((g) => g.category === 'method'));
    assert.ok(
      !STOCK_GROUPS.some((g) => g.items.length === 0),
      'an empty heading is a dangling one',
    );
  });

  test('groups follow the walk order, spirit first and garnish last', () => {
    const order = STOCK_GROUPS.map((g) => g.category);
    assert.equal(order[0], 'liquor');
    assert.equal(order.at(-1), 'finish');
    assert.deepEqual(
      order,
      CATEGORY_ORDER.filter((c) => order.includes(c)),
    );
  });

  test('the headings are not the walk’s questions', () => {
    // CATEGORY_LABELS asks "A squeeze of citrus?" — right for a guest choosing a
    // drink, wrong above a column of checkboxes. Same categories, different job.
    for (const g of STOCK_GROUPS) {
      assert.notEqual(g.label, CATEGORY_LABELS[g.category]);
      assert.ok(!g.label.includes('?'), `"${g.label}" is a question, not a heading`);
    }
    assert.equal(SHELF_LABELS.liquor, 'Spirits & liqueurs');
  });
});

describe('the pouring rule, shared', () => {
  test('a garnish does not hide a drink', () => {
    // Dry Martini is gin, dry vermouth and an olive; the olive is a `finish`.
    const cupboard = ['Gin', 'Dry Vermouth'];
    const strict = makeable(cupboard).map((r) => r.name);
    const real = makeable(cupboard, { ignore: OPTIONAL_CATEGORIES }).map((r) => r.name);
    assert.ok(!strict.includes('Dry Martini'), 'this test is pointless if the data changed');
    assert.ok(real.includes('Dry Martini'), 'a missing olive should not hide a Martini');
  });

  test('it says garnishes and nothing else', () => {
    // Widening this silently would make drinks appear that the host cannot pour.
    assert.deepEqual([...OPTIONAL_CATEGORIES], ['finish']);
  });
});
