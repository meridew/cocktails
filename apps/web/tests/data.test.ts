/**
 * The menu axes engine — the logic that decides what the bartender actually makes.
 * Pure functions, so these are the cheapest high-value tests in the repo.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRINKS,
  axesFor,
  visibleAxes,
  defaultConfig,
  buildLine,
  type Drink,
} from '../src/lib/data.ts';

const drink = (name: string): Drink => {
  const d = DRINKS.find((x) => x.name === name);
  assert.ok(d, `fixture drink "${name}" missing from DRINKS`);
  return d;
};
const keys = (ds: { key: string }[]): string[] => ds.map((a) => a.key);

const MARGARITA = drink('Margarita');
const OLD_FASHIONED = drink('Old Fashioned');
const WINE = drink('Wine');
const POM = drink('Pom & Elderflower');

describe('axesFor', () => {
  test('prepends the Boozy/Boring axis for a spirit drink', () => {
    assert.deepEqual(keys(axesFor(MARGARITA)), ['booze', 'base', 'spicy', 'strength', 'garnish']);
  });

  test('omits it when boozeChoice is false, even though the drink has spirits', () => {
    assert.equal(OLD_FASHIONED.boozeChoice, false);
    assert.ok(OLD_FASHIONED.spirits.length > 0);
    assert.deepEqual(keys(axesFor(OLD_FASHIONED)), ['strength']);
  });

  test('omits it when the drink has no spirits', () => {
    assert.deepEqual(keys(axesFor(WINE)), ['colour', 'ice']);
  });

  test('a sparkling-wine drink still gets the Boozy/Boring axis', () => {
    assert.deepEqual(keys(axesFor(POM)), ['booze', 'ice', 'garnish']);
  });

  test('every drink has unique axis keys and non-empty choices', () => {
    for (const d of DRINKS) {
      const ks = keys(axesFor(d));
      assert.deepEqual(ks, [...new Set(ks)], `${d.name} has duplicate axis keys`);
      for (const axis of axesFor(d)) {
        assert.ok(axis.choices.length > 0, `${d.name}/${axis.key} has no choices`);
      }
    }
  });
});

describe('visibleAxes', () => {
  test('Boring hides the strength axis', () => {
    assert.deepEqual(keys(visibleAxes(MARGARITA, { booze: 'Boring' })), [
      'booze',
      'base',
      'spicy',
      'garnish',
    ]);
  });

  test('Boozy shows it', () => {
    assert.ok(keys(visibleAxes(MARGARITA, { booze: 'Boozy' })).includes('strength'));
  });

  test('red wine hides the ice axis; white and rosé show it', () => {
    assert.deepEqual(keys(visibleAxes(WINE, { colour: 'Red' })), ['colour']);
    assert.ok(keys(visibleAxes(WINE, { colour: 'White' })).includes('ice'));
    assert.ok(keys(visibleAxes(WINE, { colour: 'Rosé' })).includes('ice'));
  });

  test('an absent booze key still shows strength (undefined !== "Boring")', () => {
    // Non-obvious but correct: Old Fashioned has no booze axis at all, so its
    // strength axis must remain visible. A refactor of showIf will break this.
    assert.deepEqual(keys(visibleAxes(OLD_FASHIONED, {})), ['strength']);
  });

  test('never throws for an empty config, for any drink', () => {
    for (const d of DRINKS) assert.doesNotThrow(() => visibleAxes(d, {}));
  });
});

describe('defaultConfig', () => {
  test('picks the first choice of each visible axis', () => {
    assert.deepEqual(defaultConfig(MARGARITA), {
      booze: 'Boozy',
      base: 'Classic',
      spicy: 'No',
      strength: 'Single',
      garnish: 'Yes',
    });
    assert.deepEqual(defaultConfig(OLD_FASHIONED), { strength: 'Single' });
  });

  test('evaluates showIf against the partially-built config', () => {
    // `ice` is only included because `colour` defaults to White (its first choice).
    assert.deepEqual(defaultConfig(WINE), { colour: 'White', ice: '1 cube' });
    assert.deepEqual(Object.keys(defaultConfig(WINE)), ['colour', 'ice']);
  });

  test('its keys always match the axes visible under it (invariant, all drinks)', () => {
    for (const d of DRINKS) {
      const config = defaultConfig(d);
      assert.deepEqual(
        Object.keys(config),
        keys(visibleAxes(d, config)),
        `${d.name}: defaultConfig keys diverge from visibleAxes`,
      );
    }
  });
});

describe('buildLine', () => {
  test('hidden axes leak neither tags nor ingredients', () => {
    // The most important case: strength is hidden by Boring, so "Double" must not
    // reach the label and "Extra shot" must not reach the recipe.
    const line = buildLine(MARGARITA, {
      booze: 'Boring',
      base: 'Classic',
      spicy: 'No',
      strength: 'Double',
      garnish: 'Yes',
    });
    assert.equal(line.name, 'Margarita — Boring');
    assert.equal(line.boozy, false);
    assert.ok(!line.recipe.includes('Extra shot'));
    assert.ok(!line.recipe.includes('Tequila'));
    assert.ok(!line.recipe.includes('Triple Sec / Cointreau'));
    assert.deepEqual(line.recipe, ['Lime', 'Agave', 'Salt rim', 'Crushed Ice']);
  });

  test('composes tags and adds in axis order', () => {
    const line = buildLine(MARGARITA, {
      booze: 'Boozy',
      base: 'Watermelon',
      spicy: 'Spicy',
      strength: 'Double',
      garnish: 'No',
    });
    assert.equal(line.name, 'Margarita — Watermelon, Spicy, Double, No garnish');
    assert.equal(line.boozy, true);
    assert.deepEqual(line.recipe, [
      'Tequila',
      'Triple Sec / Cointreau',
      'Lime',
      'Agave',
      'Salt rim',
      'Crushed Ice',
      'Watermelon',
      'Fresh Chili',
      'Extra shot',
    ]);
  });

  test('the default config yields just the strength tag', () => {
    assert.equal(buildLine(MARGARITA, defaultConfig(MARGARITA)).name, 'Margarita — Single');
  });

  test('boozeChoice:false is always boozy, even with no spirits', () => {
    const line = buildLine(WINE, { colour: 'Red' });
    assert.equal(line.name, 'Wine — Red');
    assert.equal(line.boozy, true);
    assert.deepEqual(line.recipe, ['House wine']);
  });

  test('wine ice adds an ingredient', () => {
    const line = buildLine(WINE, { colour: 'White', ice: '2 cubes' });
    assert.equal(line.name, 'Wine — White, 2 cubes');
    assert.deepEqual(line.recipe, ['House wine', '2 ice cubes']);
  });

  test('an empty config produces an untagged, boozy line', () => {
    const of = buildLine(OLD_FASHIONED, {});
    assert.equal(of.name, 'Old Fashioned');
    assert.equal(of.boozy, true);
    assert.ok(of.recipe.includes('Bourbon / Rye Whiskey'));

    const marg = buildLine(MARGARITA, {});
    assert.equal(marg.name, 'Margarita');
    assert.equal(marg.boozy, true, 'undefined booze is not Boring, so still boozy');
    assert.ok(marg.recipe.includes('Tequila'));
  });

  test('an unknown choice value is skipped, not thrown on', () => {
    const line = buildLine(MARGARITA, { booze: 'Boozy', spicy: 'MEGA-SPICY' });
    assert.ok(!line.name.includes('MEGA-SPICY'));
    assert.ok(!line.recipe.includes('Fresh Chili'));
  });

  test('every drink builds a sane line from its defaults', () => {
    for (const d of DRINKS) {
      const line = buildLine(d, defaultConfig(d));
      assert.ok(line.recipe.length > 0, `${d.name} has an empty recipe`);
      assert.ok(line.name.startsWith(d.name), `${d.name} label does not start with its name`);
    }
  });
});
