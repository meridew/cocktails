import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The people an end-to-end spec needs, made the way the app makes them.
 *
 * Everything here goes through the **real screens**. There is no back door that
 * fabricates a session or writes a row: that is precisely what these specs exist to
 * check, and a fixture that skipped it would be testing this file.
 *
 * `tests/fixtures/people.ts` is the same idea one layer down — it uses real HTTP but
 * bypasses the browser. The two are not duplicates: that one asks whether the
 * endpoints agree, this one asks whether the screens reach them.
 */

/** The address `ADMIN_EMAILS` names in `scripts/e2e-serve.js`. Config outranks the DB. */
export const ADMIN_EMAIL = 'admin@e2e.test';

/** Long enough for Better Auth, same for everyone — nothing here guards a secret. */
export const PASSWORD = 'e2e-password-123';

/**
 * A fresh address, unique across parallel workers and across re-runs.
 *
 * Specs share one server and one database. Two workers registering `host@e2e.test`
 * at the same moment is not a race we want to think about in every spec, so nobody
 * ever types an address literally.
 */
let seq = 0;
export const freshEmail = (label: string): string =>
  `${label}-${process.pid.toString(36)}-${(seq++).toString(36)}@e2e.test`;

interface Mail {
  to: string;
  subject: string;
  text: string;
}

const outboxPath = resolve(process.env.EMAIL_OUTBOX ?? './.e2e/outbox.jsonl');

/**
 * The verification link sent to an address, waited for.
 *
 * Polls because the send is a side effect of the sign-up request and the browser's
 * promise resolves first — without the wait this reads the file a beat too early and
 * fails intermittently, which is the worst kind of test.
 */
export async function verificationLink(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  while (Date.now() < deadline) {
    const lines = (await readFile(outboxPath, 'utf8')).split('\n').filter(Boolean);
    seen = lines.length;
    for (const line of lines.reverse()) {
      const mail = JSON.parse(line) as Mail;
      if (mail.to.toLowerCase() !== email.toLowerCase()) continue;
      const link = /https?:\/\/\S+/.exec(mail.text);
      if (link) return link[0];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no verification link for ${email} after ${timeoutMs}ms (${seen} messages seen)`);
}

/**
 * Open the sign-in drawer.
 *
 * The front door belongs to guests now — a list of what's on tonight — and signing
 * in is a rare act by a handful of people, so it lives behind an icon. Every fixture
 * that used to type straight into the page has to knock first.
 */
export async function openSignIn(page: Page): Promise<Locator> {
  // Scoped to the app bar: once the drawer is open there are two "Sign in" buttons
  // on the page — this icon and the form's submit — and an unscoped locator matches
  // both. Returns the drawer so callers can scope their own clicks the same way.
  await page.locator('.appbar').getByRole('button', { name: 'Sign in' }).click();
  const drawer = page.getByRole('dialog', { name: 'Sign in' });
  await expect(drawer).toBeVisible();
  return drawer;
}

/**
 * Register, follow the emailed link, and land wherever that person belongs.
 *
 * Verification is not skippable — an unverified account is refused everywhere — so
 * this is the shortest honest path to a usable host, and walking it is itself a test
 * of the front door.
 */
export async function register(
  page: Page,
  email: string,
  name = email.split('@')[0]!,
): Promise<void> {
  await page.goto('/');
  const drawer = await openSignIn(page);
  await drawer.getByRole('button', { name: 'I need an account' }).click();
  await drawer.getByLabel('Your name').fill(name);
  await drawer.getByLabel('Email').fill(email);
  await drawer.getByLabel('Password').fill(PASSWORD);
  await drawer.getByRole('button', { name: 'Create my account' }).click();

  // The screen has to say that signing up *happened*, because sign-up issues no
  // session and would otherwise dump you back at the form you just submitted.
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await verificationLink(email));
  // The link lands back on the front door, which routes on what the server says.
  await expect(page).toHaveURL(/\/(admin|host)$/);
}

/**
 * Sign in on a page that has no session, and **wait to arrive**.
 *
 * The click resolves as soon as the request is sent; the redirect happens after the
 * server answers and the actor is re-read. Returning before that meant the next line
 * navigated with no session yet and got bounced to the front door — which surfaced
 * as "the admin desk has no hosts on it", pointing at entirely the wrong thing.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  const drawer = await openSignIn(page);
  await drawer.getByLabel('Email').fill(email);
  await drawer.getByLabel('Password').fill(PASSWORD);
  await drawer.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(admin|host)$/);
}

/**
 * Tick a host's cupboard from their own screen.
 *
 * Ticks by visible label rather than by index: the shelves are grouped and ordered
 * by the recipe data, and a spec that depended on that ordering would break every
 * time somebody added a bottle.
 */
export async function stock(page: Page, bottles: string[]): Promise<void> {
  await page.goto('/host');
  for (const bottle of bottles) {
    await page.getByRole('checkbox', { name: bottle, exact: true }).check();
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
}

/** Dan creates a party for a host and opens it, from his own desk. */
export async function createParty(page: Page, hostName: string, partyName: string): Promise<void> {
  await page.goto('/admin');
  await page.getByRole('button', { name: new RegExp(hostName) }).click();
  await page.getByLabel('New party').fill(partyName);
  await page.getByRole('button', { name: 'Create it' }).click();

  const row = page.locator('.row', { hasText: partyName });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Work it' })).toBeVisible();
}

/**
 * Arrive at a party the way a guest does, and **wait until the device has kept it**.
 *
 * `/e/<id>` remembers the id in local storage from its `load`, which on the client
 * runs during hydration. `page.goto` resolves on the document's `load` event, which
 * is earlier — so navigating straight on to `/bar` could arrive with no party
 * remembered, and the bar would ask which one it was joining. That cost one failing
 * run in three and looked like the join code being wrong.
 *
 * A person cannot lose this race; they take a second to find the button. A test can,
 * so it waits for the thing it actually depends on rather than for a duration.
 */
export async function arriveAt(page: Page, id: string, who = 'Guest'): Promise<void> {
  await page.goto(`/e/${id}`);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cocktail_event_id'))).toBe(id);

  // A device this app has never met is asked its name on the way in; one it knows
  // joins silently, so the prompt may simply not appear. Checked rather than assumed
  // — a fixture that insisted on it would fail for the returning guest, who is the
  // commoner case after the first spec in a file.
  const arrive = page.locator('.arrive');
  if (await arrive.isVisible().catch(() => false)) {
    await arrive.getByLabel('Your name').fill(who);
    await arrive.getByRole('button', { name: "I'm in" }).click();
    await expect(arrive).toBeHidden();
  }
}

/**
 * The bar session this device is holding, as an `Authorization` header.
 *
 * `page.request` shares the context's **cookies**, which is enough for an account
 * but not for a bar session — that is a bearer token in local storage, deliberately,
 * because a helper has no account to hang a cookie on. Calling an endpoint from a
 * spec without this looks exactly like being signed out, and 401 is a much less
 * interesting answer than the 403 a spec about permissions is usually after.
 */
export async function barAuth(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('cocktail_staff_token'));
  if (!token) throw new Error('no bar session on this device');
  return { authorization: `Bearer ${token}` };
}

/**
 * The party's id, read off the host's own screen.
 *
 * Not from the clipboard, which is what the "Guest link" button uses: reading it back
 * needs a browser permission that has nothing to do with what is being tested, and a
 * denied permission would fail as "could not find the party" rather than as
 * "clipboard". The `Watch` link carries the same id in its href and is already there.
 */
export async function partyId(hostPage: Page, partyName: string): Promise<string> {
  await hostPage.goto('/host');
  const row = hostPage.locator('.row', { hasText: partyName });
  await expect(row).toBeVisible();
  const href = await row.getByRole('link', { name: 'Watch' }).getAttribute('href');
  const id = /\/host\/(.+)$/.exec(href ?? '')?.[1];
  if (!id) throw new Error(`could not read the party id from "${href}"`);
  return id;
}
