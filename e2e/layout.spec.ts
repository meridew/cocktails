import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, freshEmail, register, signIn } from './people';

/**
 * The working screens, on a screen bigger than the one they were checked on.
 *
 * **This exists because the column was pinned to the left edge in production.**
 * `.deck > *` centred each child with `margin-inline: auto`, and `.panel { margin: 0
 * 0 18px }` sits below it in `app.css` at equal specificity, so the later rule won
 * and the margins went to zero. Every phone looked right, the 800px-wide pane it was
 * developed in looked right — because the column's own 760px cap fills 800px — and a
 * real desktop did not. Dan reported it as "aligned top left".
 *
 * So the assertion is deliberately about **geometry at a width the column cannot
 * fill**, not about a class being present. A class assertion would have passed
 * throughout: both rules were there, one just lost.
 */

/** Comfortably wider than the 760px column plus the deck's 14px gutters. */
test.use({ viewport: { width: 1600, height: 900 } });

/**
 * The gap either side of the column, measured against the deck's **client** width.
 *
 * `getBoundingClientRect()` includes the scroll bar, which is on the right only — so
 * measuring against it reports a centred column as ~14px off and fails for a reason
 * that is not the bug.
 */
async function gutters(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const deck = document.querySelector('.deck')!;
    // Whatever the deck's first real child is, rather than a named component. The
    // front door holds a grid of party cards and no `.panel` at all; naming classes
    // here made this a test of which components a page happens to use.
    const child = deck.firstElementChild!;
    const d = deck.getBoundingClientRect();
    const c = child.getBoundingClientRect();
    const left = c.left - d.left;
    const right = d.left + deck.clientWidth - c.right;
    return { left: Math.round(left), right: Math.round(right), width: Math.round(c.width) };
  });
}

for (const [name, open] of [
  ['the front door', async (page: import('@playwright/test').Page) => page.goto('/')],
  [
    'a host’s own bar',
    async (page: import('@playwright/test').Page) => {
      await register(page, freshEmail('layout-host'), 'Layout Host');
    },
  ],
  [
    'the admin desk',
    async (page: import('@playwright/test').Page) => {
      await signIn(page, ADMIN_EMAIL);
    },
  ],
] as const) {
  test(`${name} centres its column on a wide screen`, async ({ page }) => {
    await open(page);
    await expect(page.locator('.deck > *').first()).toBeVisible();

    const { left, right, width } = await gutters(page);
    // Capped rather than exact: the working screens read at 760 and the front door
    // holds cards rather than prose, so it is allowed to be wider. What matters to
    // this test is that the column is centred and not filling the screen.
    expect(width).toBeLessThanOrEqual(1040);
    // Within a pixel: sub-pixel layout can split an odd remainder.
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    // And it really is a wide screen — otherwise the column fills it and this
    // passes without proving anything, which is exactly how the bug survived.
    expect(left).toBeGreaterThan(100);
  });
}
