import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, PASSWORD, freshEmail, register, signIn } from './people';

/**
 * The front door: register, verify, and be sent where you belong.
 *
 * Every other spec starts by walking this, so it is worth failing here — a broken
 * sign-up would otherwise surface as five specs failing on their second step with
 * nothing pointing at the cause.
 */

test('a new host registers, verifies, and lands on their own bar', async ({ page }) => {
  const email = freshEmail('door');
  await register(page, email, 'Wren');

  await expect(page).toHaveURL(/\/host$/);
  await expect(page.getByRole('heading', { name: "What you've got in" })).toBeVisible();
  // The cupboard is the screen, not a thing behind a button — a host who has just
  // registered should be one tap from ticking a bottle.
  await expect(page.getByRole('checkbox', { name: 'Gin', exact: true })).toBeVisible();
});

test('an unverified account is told so, and is not signed in', async ({ page }) => {
  const email = freshEmail('unverified');
  await page.goto('/');
  await page.getByRole('button', { name: 'I need an account' }).click();
  await page.getByLabel('Your name').fill('Unverified');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  // Sign-up issues no session on purpose. Asking for /host must not let them in.
  await page.goto('/host');
  await expect(page).toHaveURL(/\/$/);
});

test('a wrong password says so rather than half-working', async ({ page }) => {
  const email = freshEmail('wrongpw');
  await register(page, email, 'Wrongpw');
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('ADMIN_EMAILS outranks the database — Dan lands on the admin desk', async ({ page }) => {
  // Registered in global setup like any other host, and its `role` column says
  // `host`. Config is what makes it admin, and config is re-read on every request,
  // so no edit made inside the app can lock the operator out of their own service.
  await signIn(page, ADMIN_EMAIL);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
});

test('an ordinary host cannot reach the admin desk', async ({ page }) => {
  const email = freshEmail('notadmin');
  await register(page, email, 'Notadmin');
  await page.goto('/admin');
  // Bounced to the front door, which then sends them where they belong. The
  // endpoints refuse anyway; this only avoids drawing a screen that would 403.
  await expect(page).toHaveURL(/\/host$/);
});

test('signing out is really signing out', async ({ page }) => {
  const email = freshEmail('out');
  await register(page, email, 'Outgoing');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/host');
  await expect(page).toHaveURL(/\/$/);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/host$/);
});
