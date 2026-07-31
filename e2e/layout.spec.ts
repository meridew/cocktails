import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, createParty, freshEmail, openPartyDesk, register, signIn } from './people';

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

/**
 * A row's name is never squeezed out by its own buttons.
 *
 * **This exists because it happened, on the admin party row.** `.row-main` carried
 * `min-width: 0` and `.row-acts` carried `flex: none`, so the actions took every
 * pixel they wanted from the only column that would yield. Measured at the time:
 * five buttons wanting 438px in a 427px row left the name **exactly 0px** wide and
 * overflowed by 23px anyway, so a party's name and status painted underneath its
 * own buttons. Reported as "confusion as to what is what".
 *
 * Narrow on purpose. At 1600px there is room for everything and this proves nothing
 * — which is precisely why it went unnoticed.
 */
test.describe('a row under pressure', () => {
  test.use({ viewport: { width: 380, height: 900 } });

  test('keeps the name readable rather than giving its width to the buttons', async ({
    browser,
    page,
  }) => {
    const tag = Date.now().toString(36);
    const hostName = `Rowhost ${tag}`;

    // The host registers in their own context. Registering and then signing in as
    // somebody else on one page races the app bar's own re-render, which fails as a
    // detached-element click and points nowhere near this test's subject.
    const theirs = await browser.newContext().then((c) => c.newPage());
    await register(theirs, freshEmail('layout-row'), hostName);
    await theirs.close();

    await signIn(page, ADMIN_EMAIL);
    await createParty(page, hostName, `A Party With A Rather Long Name ${tag}`);
    await openPartyDesk(page, `A Party With A Rather Long Name ${tag}`);

    /*
     * Put the row back under the pressure that broke it.
     *
     * The redesign cut that row to a name and one button, which fits at any width —
     * so measuring it as-is passes on the old CSS too and proves nothing. The rule
     * being tested is not "this row is fine", it is "`.row-main` keeps a floor when
     * `.row-acts` wants more than there is", and that needs a row with more actions
     * than fit. Four extra buttons is roughly the five the old party row carried.
     */
    const measured = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.row')].find(
        (r) => r.querySelector('.row-main') && r.querySelector('.row-acts'),
      )!;
      const acts = row.querySelector('.row-acts')!;
      for (const label of ['Close', 'Work it', 'Menu', 'Delete']) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = label;
        acts.appendChild(b);
      }
      const main = row.querySelector('.row-main')!;
      const r = row.getBoundingClientRect();
      return {
        nameWidth: Math.round(main.getBoundingClientRect().width),
        overflow: Math.round(acts.getBoundingClientRect().right - r.right),
      };
    });

    // A floor, not a specific number: the point is that the column still exists.
    // It measured exactly 0 when this was broken.
    expect(measured.nameWidth).toBeGreaterThan(80);
    // Nothing hangs out of the row, so nothing can paint over the text.
    expect(measured.overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * Muted text on the bar's dark surfaces is actually readable.
 *
 * **This exists because it was invisible.** `--text-soft` is defined once at
 * `:root` as `rgba(10,10,18,0.65)`, which is right on the white cards it was
 * written for. `.bartender` flips to `background: var(--panel-bg)` (#0a0a12)
 * without flipping the muted token, so everything neo.css colours with it —
 * `.bt-empty`, `.bt-ago` — rendered near-black on near-black. Not poor contrast:
 * a ratio of about 1.02, which is none.
 *
 * The bar staff screen showed a Revoke button with nothing beside it, and an empty
 * queue looked like a screen that had failed to load rather than a bar that was
 * keeping up.
 *
 * Asserted as a contrast ratio rather than as a specific colour, because the fix is
 * "this must be legible", not "this must be #9e9e9e".
 */
test.describe('the bar in the dark', () => {
  test('muted text on the bar keeps enough contrast to read', async ({ page }) => {
    const tag = Date.now().toString(36);
    const hostName = `Darkhost ${tag}`;
    const theirs = await page
      .context()
      .browser()!
      .newContext()
      .then((c) => c.newPage());
    await register(theirs, freshEmail('layout-dark'), hostName);
    await theirs.close();

    await signIn(page, ADMIN_EMAIL);
    await createParty(page, hostName, `Dark Party ${tag}`);
    await page
      .locator('.row', { hasText: `Dark Party ${tag}` })
      .getByRole('button', { name: 'Work it' })
      .click();
    await expect(page).toHaveURL(/\/bar$/);

    // A brand new party has no orders, so the queue renders its empty state — which
    // is the element that was invisible.
    const empty = page.locator('.bt-empty').first();
    await expect(empty).toBeVisible();

    const ratio = await empty.evaluate((el) => {
      /** sRGB relative luminance, per WCAG. */
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const parse = (s: string) =>
        s
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);

      // The text's own colour may be translucent, so composite it over whatever is
      // actually behind it — otherwise this measures a colour nobody ever sees.
      const cs = getComputedStyle(el);
      const fg = cs.color.match(/[\d.]+/g)!.map(Number);
      const alpha = fg.length > 3 ? fg[3]! : 1;

      let node: Element | null = el;
      let bg = [0, 0, 0];
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        const v = c.match(/[\d.]+/g)?.map(Number);
        if (v && (v.length < 4 || v[3]! > 0)) {
          bg = v.slice(0, 3);
          break;
        }
        node = node.parentElement;
      }

      const composite = fg.slice(0, 3).map((v, i) => v * alpha + bg[i]! * (1 - alpha));
      const a = lum(composite) + 0.05;
      const b = lum(bg) + 0.05;
      return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
    });

    // 4.5:1 is the WCAG AA threshold for body text. It measured 1.02 when broken.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
