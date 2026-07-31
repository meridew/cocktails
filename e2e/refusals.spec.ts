import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  PASSWORD,
  arriveAt,
  barAuth,
  createParty,
  freshEmail,
  partyId,
  register,
  signIn,
  stock,
} from './people';

/**
 * The things that must not work.
 *
 * `tests/capabilities.test.ts` and `tests/tenancy.test.ts` already prove the
 * endpoints refuse these, one HTTP call at a time. What they cannot say is whether a
 * **browser carrying a real session** can get round them — whether a screen offers a
 * control it shouldn't, whether a stored id reaches a party it doesn't belong to,
 * whether a suspended account's existing tab keeps working.
 *
 * So each of these holds a genuinely valid credential and is refused anyway. A spec
 * that signed in as nobody would be proving something much weaker.
 */

const stranger = (browser: Browser): Promise<Page> => browser.newContext().then((c) => c.newPage());

const phone = (browser: Browser): Promise<Page> =>
  browser
    .newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    .then((c) => c.newPage());

/**
 * A host with a stocked cupboard and a live party of their own.
 *
 * Takes the bottles rather than assuming a default, because `stock()` *adds* ticks —
 * a second call does not replace the first. Stocking a party twice gave one host both
 * gin and tequila, and a tenancy test that could not tell "the wrong menu" from "the
 * right menu, wrongly stocked".
 */
async function aParty(browser: Browser, label: string, bottles = ['Gin', 'Tonic Water']) {
  const email = freshEmail(label);
  const tag = email.split('@')[0]!;
  const hostName = `Host ${tag}`;
  // Deliberately not built from `label`: "Party suspended-…" made the party's own
  // Delete button match a search for "Suspend".
  const partyName = `Night ${tag}`;

  const host = await stranger(browser);
  await register(host, email, hostName);
  await stock(host, bottles);

  const dan = await stranger(browser);
  await signIn(dan, ADMIN_EMAIL);
  await createParty(dan, hostName, partyName);
  const id = await partyId(host, partyName);
  return { host, dan, id, email, hostName, partyName };
}

test('a host can watch their party but not work it', async ({ browser }) => {
  const { host, id } = await aParty(browser, 'watcher');

  await host.goto(`/host/${id}`);
  await expect(host.getByRole('heading', { name: "What's happening" })).toBeVisible();

  // Not one control on the page changes an order. That is the point of the screen —
  // a host is a customer, and the capability table gives an owner `orders:read` and
  // nothing else.
  for (const label of ['▶ Start', '🍹 Ready', '✓ Done', 'Clear']) {
    await expect(host.getByRole('button', { name: label })).toHaveCount(0);
  }

  // And the bar itself refuses them: an account cookie is not a bar session, and
  // being the owner does not mint one.
  await host.goto('/bar');
  await expect(host.locator('.bt-gate')).toBeVisible();
  await expect(host.locator('.ord')).toHaveCount(0);
});

test('the server refuses too, not just the screen', async ({ browser }) => {
  const { host, id } = await aParty(browser, 'refused');

  // Straight at the endpoint, carrying the owner's own cookie — the case a screen
  // with no button cannot rule out.
  const res = await host.request.post(`/api/orders/whatever/bump?eventId=${id}`);
  expect(res.status()).toBe(403);
});

test("one party's guest cannot see another's menu", async ({ browser }) => {
  // Two cupboards with nothing in common, so "the same menu" and "the right menu"
  // cannot be confused for one another.
  const mine = await aParty(browser, 'tenant-a', ['Gin', 'Tonic Water']);
  const theirs = await aParty(browser, 'tenant-b', [
    'Tequila',
    'Triple Sec',
    'Lime Juice',
    'Agave Syrup',
  ]);

  const guest = await phone(browser);
  await arriveAt(guest, mine.id);
  await expect(guest.locator('.cocktail', { hasText: 'Gin & Tonic' }).first()).toBeVisible();
  await expect(guest.locator('.cocktail', { hasText: 'Margarita' })).toHaveCount(0);

  // The same device walks to the other party. It must get that party's menu, not a
  // remembered one — the whole reason the id lives in the path.
  await arriveAt(guest, theirs.id);
  await expect(guest.locator('.cocktail', { hasText: 'Margarita' }).first()).toBeVisible();
  await expect(guest.locator('.cocktail', { hasText: 'Gin & Tonic' })).toHaveCount(0);
});

test('a host cannot reach a party that is not theirs', async ({ browser }) => {
  const mine = await aParty(browser, 'nosy');
  const theirs = await aParty(browser, 'private');

  await mine.host.goto(`/host/${theirs.id}`);
  // Bounced back to their own list. 404 and 403 are indistinguishable on purpose:
  // an id must not become a way to discover whose party is real.
  await expect(mine.host).toHaveURL(/\/host$/);

  const res = await mine.host.request.get(`/api/events/${theirs.id}`);
  expect(res.status()).toBe(404);
});

test('a suspended host is out, including from the tab they already had open', async ({
  browser,
}) => {
  const { host, dan, hostName, email } = await aParty(browser, 'suspended');

  // Their session is live and working right now.
  await host.goto('/host');
  await expect(host.getByRole('heading', { name: 'Your parties' })).toBeVisible();

  await dan.goto('/admin');
  await dan.getByRole('button', { name: new RegExp(hostName) }).click();
  // Suspending asks why — the reason is for Dan's records, not the host's eyes.
  dan.once('dialog', (d) => void d.accept('e2e'));
  await dan.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(dan.getByText(/suspended/i).first()).toBeVisible();

  // The ban is checked when the actor is resolved, not when the session is issued,
  // so it lands on a session that already exists rather than waiting for the next
  // sign-in.
  await host.reload();
  await expect(host).toHaveURL(/\/$/);

  // And signing in again does not get them back — but it *does* succeed, because
  // Better Auth does not know about the ban and their password is still correct.
  // The screen has to say what happened; landing back on the form having signed in
  // successfully, with nothing said, is the dead end this assertion exists to stop.
  await host.getByLabel('Email').fill(email);
  await host.getByLabel('Password').fill(PASSWORD);
  await host.getByRole('button', { name: 'Sign in' }).click();
  await expect(host.getByRole('heading', { name: 'This account is closed' })).toBeVisible();
  await expect(host).toHaveURL(/\/$/);
});

test('a helper pours, but does not decide what is on the menu', async ({ browser }) => {
  const { dan, host, id, hostName, partyName } = await aParty(browser, 'helper-limits');

  await dan.goto('/admin');
  await dan.getByRole('button', { name: new RegExp(hostName) }).click();
  await dan
    .locator('.row', { hasText: partyName })
    .getByRole('button', { name: 'Work it' })
    .click();
  await dan.getByRole('button', { name: /Bar options/ }).click();
  await dan.getByRole('button', { name: 'Bar staff' }).click();
  await dan.getByRole('button', { name: 'Show a join code' }).click();
  const code = (await dan.locator('.joincode').innerText()).trim();

  const helper = await phone(browser);
  await arriveAt(helper, id);
  await helper.goto('/bar');
  await helper.getByRole('button', { name: 'Helping out tonight?' }).click();
  await helper.getByPlaceholder('your name').fill('Marco');
  await helper.getByLabel('Join code').fill(code);
  await helper.getByLabel('Join code').press('Enter');
  await expect(helper.locator('.bt-gate')).toHaveCount(0);
  const headers = await barAuth(helper);

  // They are genuinely in — this is a working bar session, not a rejected one.
  const orders = await helper.request.get(`/api/orders?eventId=${id}`, { headers });
  expect(orders.status()).toBe(200);

  // And still 403 on curation. Pouring what the party serves is not choosing it,
  // and the two used to be the same credential.
  const curate = await helper.request.put(`/api/events/${id}/menu`, {
    headers,
    data: { recipes: ['negroni'] },
  });
  expect(curate.status()).toBe(403);

  // The host, who *is* allowed, gets 200 for the same call.
  const owner = await host.request.put(`/api/events/${id}/menu`, { data: { recipes: [] } });
  expect(owner.status()).toBe(200);
});
