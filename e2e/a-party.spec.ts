import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  arriveAt,
  createParty,
  freshEmail,
  askAndApprove,
  partyId,
  register,
  signIn,
  stock,
} from './people';

/**
 * A whole party, from four sides at once.
 *
 * This is the spec phase 6 exists for. Everything it touches is covered somewhere in
 * `npm test` already — but always one participant at a time, against handlers called
 * in-process. What is not covered anywhere else is whether the **four of them agree**:
 * a host's cupboard becoming a guest's menu, a guest's order becoming a row on a
 * bartender's screen, a bartender's taps becoming a drink that is done.
 *
 * Four browser contexts, because that is four devices. Sharing one would share a
 * session and a localStorage, and quietly stop being a test of anything.
 *
 * **The push notification is not asserted.** Headless Chromium has no push service to
 * register with and the run disables VAPID outright, so the last leg — the guest's
 * phone buzzing — is a code path that runs and an arrival nobody here can observe.
 * §8 phase 4 says the same of it: it wants a real device.
 */

/** Enough for a Margarita and a Daiquiri, and pointedly not enough for a Mojito. */
const CUPBOARD = [
  'Tequila',
  'White Rum',
  'Triple Sec',
  'Lime Juice',
  'Agave Syrup',
  'Simple Syrup',
];

/** A device that has never signed in to anything. */
const stranger = (browser: Browser): Promise<Page> => browser.newContext().then((c) => c.newPage());

/**
 * The same, on a phone.
 *
 * Not decoration: above 900px neo.css hides the tab bar and pins the order rail
 * open, so the desktop guest never touches the sheet that every real guest uses.
 * Guests and helpers are on phones; hosts and Dan are at a laptop. Testing them any
 * other way would test a layout nobody is in.
 */
const phone = (browser: Browser): Promise<Page> =>
  browser
    .newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    .then((c) => c.newPage());

test('a host stocks up, Dan opens the bar, a guest orders and a helper pours it', async ({
  browser,
}) => {
  const hostEmail = freshEmail('party-host');
  const tag = hostEmail.split('@')[0]!;
  const hostName = `Rae ${tag}`;
  const partyName = `Saturday ${tag}`;

  // ---- the host: register, tick what's in ---------------------------------
  const host = await stranger(browser);
  await register(host, hostEmail, hostName);
  await stock(host, CUPBOARD);

  // ---- Dan: make them a party and open it ---------------------------------
  const dan = await stranger(browser);
  await signIn(dan, ADMIN_EMAIL);
  await createParty(dan, hostName, partyName);
  const id = await partyId(host, partyName);

  // ---- the guest: a menu generated from that cupboard ---------------------
  const guest = await phone(browser);
  await arriveAt(guest, id, 'Priya');

  const margarita = guest.locator('.cocktail', { hasText: 'Margarita' }).first();
  await expect(margarita).toBeVisible();
  // Six bottles is more than six drinks, and it is emphatically not "the curated six
  // filtered down" — a Mojito needs mint, which this cupboard hasn't got.
  await expect(guest.locator('.cocktail', { hasText: 'Daiquiri' }).first()).toBeVisible();
  await expect(guest.locator('.cocktail', { hasText: 'Mojito' })).toHaveCount(0);

  await margarita.getByRole('button', { name: 'Add to order' }).click();
  // Margarita is one of the six house drinks, so it has options and opens the sheet.
  const sheet = guest.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Add to order' }).click();

  // No name to type: they gave it on the way in, so the rail already knows and
  // sending a round is one tap. That is the point of asking on arrival.
  await guest.locator('.tab-order').click();
  await expect(guest.getByLabel('Ordering as')).toHaveValue('Priya');
  await guest.getByRole('button', { name: 'Send order' }).click();
  await expect(guest.getByRole('heading', { name: /Cheers/ })).toBeVisible();

  // ---- Dan: behind the bar ------------------------------------------------
  // Straight off the front list: the desk opens on parties, so getting behind a bar
  // no longer means remembering whose party it is first.
  await dan.goto('/admin');
  await dan
    .locator('.row', { hasText: partyName })
    .getByRole('button', { name: 'Work it' })
    .click();
  // Named in the address: the bar used to be told which party by device storage,
  // which any guest menu could overwrite behind its back.
  await expect(dan).toHaveURL(new RegExp(`/bar/${id}$`));
  await expect(dan.locator('.ord', { hasText: 'Priya' })).toBeVisible();

  // ---- the helper: asked for, waved in, and pouring ----------------------
  const helper = await phone(browser);
  await askAndApprove(helper, dan, id, 'Marco');

  const order = helper.locator('.ord', { hasText: 'Priya' });
  await expect(order).toBeVisible();
  await expect(order.getByText(/Margarita/)).toBeVisible();

  // Priya is a face this bar has not seen, so her card offers **Admit** where an
  // ordinary one offers Start — the drink is visible but cannot be made yet. That is
  // the admission gate, and it is the whole reason the first tap here is different
  // from the three that follow.
  // Matched by its text, which is now possible: this chip used to read "new" and so
  // did the `pending` status badge next to it, so the word found both and the test
  // had to reach for the class instead. The workaround outlived the excuse for it.
  const newFace = order.getByText('not in', { exact: true });
  await expect(newFace).toBeVisible();
  // Located by its accessible name, not its glyph: the pair was shrunk to share one
  // ordinary button's width, so the visible label is now a ✓ and the words moved to
  // `aria-label`. Matching on the label is the assertion that survives that.
  await order.getByRole('button', { name: /Let .* in/ }).click();
  await expect(newFace).toHaveCount(0);

  // Round it to done. Each button carries the bar's own word for the step it is
  // offering, so this walks the flow that exists rather than tapping a fixed number
  // of times and hoping.
  for (const label of ['▶ Start', '🍹 Ready', '✓ Done']) {
    await order.getByRole('button', { name: label }).click();
  }

  // It leaves the Active tab, which is the point of the Active tab — so the proof
  // that it is done is that it is now under Done, and not that it is still there.
  await expect(order).toHaveCount(0);
  await helper.getByRole('button', { name: /^Done/ }).click();
  await expect(order).toBeVisible();

  // ---- and the host, who never touched a thing, can see it happened -------
  await host.goto(`/host/${id}`);
  await expect(host.getByText(/1\s*poured/)).toBeVisible();
});
