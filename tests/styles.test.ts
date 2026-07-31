/**
 * `app.css` must not redefine anything `neo.css` already owns.
 *
 * **This exists because it happened.** The working screens needed a page wrapper, it
 * got called `.sheet`, and `.sheet` is already neo.css's modal dialog — a
 * fixed-position overlay with a dark backdrop. Three pages turned into overlapping
 * floating cards on a black screen, and nothing failed: the typecheck was clean, all
 * 397 tests passed, and the DOM queries I was verifying with reported exactly the
 * right structure. It was only visible by looking at it.
 *
 * `neo.css` is a verbatim copy of the original design and is frozen by a guardrail
 * (see `CLAUDE.md`), so its class names are a fixed set that will never grow. That
 * makes this cheap to check and worth checking: a collision is always a mistake,
 * because the whole point of the guardrail is that `neo.css` wins.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string): string =>
  readFileSync(join(process.cwd(), 'src', 'lib', name), 'utf8');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every class name mentioned anywhere on a left-hand side. */
function classesMentionedIn(css: string): Set<string> {
  const out = new Set<string>();
  for (const block of stripComments(css).split('}')) {
    const selector = block.split('{')[0];
    if (!selector) continue;
    for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]!);
  }
  return out;
}

/**
 * Classes a stylesheet claims **wholesale** — a rule whose entire selector is one
 * class, like `.sheet { … }`.
 *
 * That distinction is the whole test. `.cocktail.is-out` and `.bt-badge.b-pending`
 * are *modifiers* on a neo.css component, which is the intended way to extend it and
 * is all over `app.css` legitimately. A bare `.sheet { position: fixed }` is
 * something else: it silently replaces what the component means everywhere it is
 * used, including in files nobody is currently looking at.
 */
function classesClaimedWholesaleIn(css: string): Set<string> {
  const out = new Set<string>();
  for (const block of stripComments(css).split('}')) {
    const selectorList = block.split('{')[0];
    if (!selectorList) continue;
    for (const selector of selectorList.split(',')) {
      // Pseudo-classes and -elements don't narrow which component this is.
      const bare = selector.trim().replace(/::?[\w-]+(\([^)]*\))?/g, '');
      const m = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(bare);
      if (m) out.add(m[1]!);
    }
  }
  return out;
}

/**
 * Overrides that are deliberate, listed so that adding one is a decision.
 *
 * Both of these raise a touch target to the 44px minimum: `neo.css` sizes them at
 * 34–36px, which is too small to hit reliably on a phone and is the one thing worth
 * overruling the original design about. They adjust a dimension rather than replacing
 * the component, which is why they are fine and `.sheet` was not.
 *
 * An entry here should come with a reason. If one ever appears without one, that is
 * the bug this test is looking for.
 */
const INTENTIONAL: Record<string, string> = {
  fav: 'raises the favourite button to a 44px touch target',
  'qty-btn': 'raises the quantity stepper to a 44px touch target',
};

describe('app.css stays out of neo.css’s way', () => {
  test('no neo.css component is redefined wholesale', () => {
    const neo = classesClaimedWholesaleIn(read('neo.css'));
    const app = classesClaimedWholesaleIn(read('app.css'));
    const clash = [...app].filter((c) => neo.has(c) && !(c in INTENTIONAL)).sort();

    assert.deepEqual(
      clash,
      [],
      `app.css redefines ${clash.length} neo.css component(s) outright: ${clash.join(', ')}. ` +
        'neo.css is frozen and wins; extend with a modifier, pick another name, or — if ' +
        'the override is genuinely intended — add it to INTENTIONAL with the reason.',
    );
  });

  test('the allowlist only lists things that are actually overridden', () => {
    // A stale exemption is worse than none: it reads as "this was considered" while
    // silently permitting whatever takes that name next.
    const app = classesClaimedWholesaleIn(read('app.css'));
    const stale = Object.keys(INTENTIONAL).filter((c) => !app.has(c));
    assert.deepEqual(stale, [], 'INTENTIONAL exempts a class app.css no longer overrides');
  });

  test('extending one with a modifier is still allowed', () => {
    // The rule above must not have banned the normal way of building on neo.css, or
    // the next person will delete it rather than work around it.
    const app = stripComments(read('app.css'));
    assert.match(app, /\.cocktail\.is-out/, 'modifiers on neo.css components are fine');
    assert.ok(
      classesMentionedIn(read('app.css')).has('cocktail'),
      'app.css legitimately mentions neo.css classes; only wholesale claims are the problem',
    );
  });

  test('neo.css really is the frozen one, so this test has a subject', () => {
    // If neo.css ever stops defining the classes the app is built from, this whole
    // check is measuring nothing and should be reconsidered rather than deleted.
    const neo = classesClaimedWholesaleIn(read('neo.css'));
    for (const core of ['cocktail', 'appbar', 'menu', 'order', 'sheet']) {
      assert.ok(neo.has(core), `neo.css should still define .${core}`);
    }
  });
});
