import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  arriveAt,
  createParty,
  freshEmail,
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
  await arriveAt(guest, id);

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

  await guest.locator('.tab-order').click();
  await guest.getByLabel('Your name').fill('Priya');
  await guest.getByRole('button', { name: 'Send order' }).click();
  await expect(guest.getByRole('heading', { name: /Cheers/ })).toBeVisible();

  // ---- Dan: behind the bar, and a code for whoever is helping -------------
  await dan.goto('/admin');
  await dan.getByRole('button', { name: new RegExp(hostName) }).click();
  await dan
    .locator('.row', { hasText: partyName })
    .getByRole('button', { name: 'Work it' })
    .click();
  await expect(dan).toHaveURL(/\/bar$/);
  await expect(dan.locator('.ord', { hasText: 'Priya' })).toBeVisible();

  await dan.getByRole('button', { name: /Bar options/ }).click();
  await dan.getByRole('button', { name: 'Bar staff' }).click();
  await dan.getByRole('button', { name: 'Show a join code' }).click();
  const code = (await dan.locator('.joincode').innerText()).trim();
  expect(code).toMatch(/^\d+$/);

  // ---- the helper: in on a code, and pouring ------------------------------
  const helper = await phone(browser);
  // Arriving at the party first is what tells this device which bar it is joining —
  // a helper always comes through a guest link, never to a bare /bar.
  await arriveAt(helper, id);
  await helper.goto('/bar');
  await helper.getByRole('button', { name: 'Helping out tonight?' }).click();
  await helper.getByPlaceholder('your name').fill('Marco');
  await helper.getByLabel('Join code').fill(code);
  await helper.getByLabel('Join code').press('Enter');

  const order = helper.locator('.ord', { hasText: 'Priya' });
  await expect(order).toBeVisible();
  await expect(order.getByText(/Margarita/)).toBeVisible();

  // Priya is a face this bar has not seen, so her card offers **Admit** where an
  // ordinary one offers Start — the drink is visible but cannot be made yet. That is
  // the admission gate, and it is the whole reason the first tap here is different
  // from the three that follow.
  // The chip by class, not by text: a pending order's status badge also reads NEW,
  // and matching on the word finds both.
  const newFace = order.locator('.ord-newflag');
  await expect(newFace).toBeVisible();
  await order.getByRole('button', { name: '✓ Admit' }).click();
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
