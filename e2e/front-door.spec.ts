import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL,
  PASSWORD,
  freshEmail,
  openSettings,
  openSignIn,
  register,
  signIn,
} from './people';

/**
 * The front door: register, verify, and find your way on.
 *
 * Every other spec starts by walking this, so it is worth failing here — a broken
 * sign-up would otherwise surface as five specs failing on their second step with
 * nothing pointing at the cause.
 *
 * **It no longer throws a signed-in person off itself.** Verifying used to redirect
 * to `/host` or `/admin` with `replaceState`, so a host could not look at what was
 * on tonight and could not get back with Back — which meant a host who wanted a
 * drink at their own party was locked out of the one screen that offers one. Where
 * you belong is a named row on the page now.
 */

test('a new host registers, verifies, and can reach their own bar', async ({ page }) => {
  const email = freshEmail('door');
  await register(page, email, 'Wren');

  // Still on the door, and still able to see what's on — this is the fix.
  await expect(page).toHaveURL(/\/\?verified$/);
  await expect(page.locator('.doors')).toContainText('your bar');

  await page
    .locator('.doors')
    .getByRole('link', { name: /your bar/ })
    .click();
  await expect(page).toHaveURL(/\/host$/);
  await expect(page.getByRole('heading', { name: "What you've got in" })).toBeVisible();

  // This used to assert the tick list itself was on the page, on the grounds that a
  // host who has just registered should be one tap from ticking a bottle. That is
  // still the requirement, and it is still met — but the list is now a full-screen
  // sheet, because inline it measured 7,859px and pushed "Your parties" some nine
  // screens below the fold. So: one tap, on a primary button, above the fold.
  await expect(page.getByRole('heading', { name: 'Your parties' })).toBeVisible();
  await page.getByRole('button', { name: 'Fill it in' }).click();
  await expect(page.getByRole('checkbox', { name: 'Gin', exact: true })).toBeVisible();
});

test('an unverified account is told so, and is not signed in', async ({ page }) => {
  const email = freshEmail('unverified');
  await page.goto('/');
  const drawer = await openSignIn(page);
  await drawer.getByRole('button', { name: 'I need an account' }).click();
  await drawer.getByLabel('Your name').fill('Unverified');
  await drawer.getByLabel('Email').fill(email);
  await drawer.getByLabel('Password').fill(PASSWORD);
  await drawer.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Sign-up issues no session on purpose. Asking for /host must not let them in —
  // and it now **says so where they asked**, rather than bouncing them to the front
  // door and forgetting what they wanted. A deep link that survives its own
  // permission check is the whole point of the gate.
  await page.goto('/host');
  await expect(page).toHaveURL(/\/host$/);
  await expect(page.getByRole('heading', { name: 'Sign in to see this' })).toBeVisible();
});

test('a wrong password says so rather than half-working', async ({ page }) => {
  const email = freshEmail('wrongpw');
  await register(page, email, 'Wrongpw');
  await openSettings(page);
  await page.getByRole('button', { name: 'Sign out' }).click();

  const drawer = await openSignIn(page);
  await drawer.getByLabel('Email').fill(email);
  await drawer.getByLabel('Password').fill('not-the-password');
  await drawer.getByRole('button', { name: 'Sign in' }).click();
  // The error belongs in the drawer, beside the form that produced it.
  await expect(drawer.getByRole('alert')).toBeVisible();
});

test('ADMIN_EMAILS outranks the database — Dan lands on the admin desk', async ({ page }) => {
  // Registered in global setup like any other host, and its `role` column says
  // `host`. Config is what makes it admin, and config is re-read on every request,
  // so no edit made inside the app can lock the operator out of their own service.
  await signIn(page, ADMIN_EMAIL);
  await expect(page).toHaveURL(/\/admin$/);
  // The desk opens on parties, not on people — the work is a party, and finding one
  // used to mean remembering whose it was. Hosts are one link away, and both are
  // real routes now rather than a `tab` field nothing outside the component knew.
  await expect(page.getByRole('link', { name: /^Parties/ })).toBeVisible();
  await page.getByRole('link', { name: /^Hosts/ }).click();
  await expect(page).toHaveURL(/\/admin\/hosts$/);
});

test('an ordinary host cannot reach the admin desk', async ({ page }) => {
  const email = freshEmail('notadmin');
  await register(page, email, 'Notadmin');
  await page.goto('/admin');
  // **Told, not bounced.** The endpoints refuse anyway; this says which door they
  // are at rather than silently moving them somewhere they did not ask for.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Not your door' })).toBeVisible();
});

test('signing out is really signing out', async ({ page }) => {
  const email = freshEmail('out');
  await register(page, email, 'Outgoing');

  // Signing out lives in Settings now, not in the app bar's corner — that corner
  // means "up" on every other screen, and `/host/<id>` is one tap from `/host`.
  await openSettings(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/host');
  await expect(page.getByRole('heading', { name: 'Sign in to see this' })).toBeVisible();

  await signIn(page, email);
  await expect(page).toHaveURL(/\/host$/);
});
