import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end, against the built app.
 *
 * `npm test` already drives every endpoint in-process, and does it in six seconds.
 * This exists for the things that cannot be reached that way: whether the screens
 * actually wire up to those endpoints, whether a session survives a real redirect,
 * and whether the loop from "a host registers" to "a guest is told their drink is
 * ready" holds together across four different browser contexts.
 *
 * So the specs here are deliberately few and deliberately whole. A test that asserts
 * a button's label belongs in vitest with the DOM; a test that asserts a *party
 * works* belongs here.
 */
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Registers the one admin account before any worker starts — see the file.
  globalSetup: './e2e/global-setup.ts',
  // Every spec builds its own people from unique emails, so they share the server
  // without sharing state. The one thing they must not share is a *browser* context,
  // and Playwright gives each test its own by default.
  fullyParallel: true,
  // Ten cores on the M4. Locally, half the machine — leaving the rest for the editor
  // and the dev server that is probably still running.
  workers: process.env.CI ? 10 : '50%',
  // A failing e2e test is nearly always a real failure, but "nearly" is doing work:
  // these drive four contexts against one server, and a genuinely flaky one should
  // cost a retry rather than a red build somebody learns to ignore.
  retries: process.env.CI ? 1 : 0,
  // Nothing here should take 30s. A spec that does is stuck, and the default timeout
  // just makes finding out slower.
  timeout: 30_000,
  expect: { timeout: 7_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: BASE,
    // Kept only for failures: a trace per passing test is a gigabyte of nothing.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // The build is a separate step (`npm run test:e2e`) rather than part of this
    // command, so a re-run against an unchanged tree doesn't rebuild — and so a
    // build failure reads as a build failure rather than as "the server never came
    // up".
    command: 'node scripts/e2e-serve.js',
    url: `${BASE}/api/health`,
    // Never reuse: the server wipes its database on start, and a reused one would be
    // carrying the last run's parties. Locally that reads as tests passing for the
    // wrong reason.
    reuseExistingServer: false,
    // The app logs every request; ten workers make that thousands of lines around
    // the one that matters. Errors still come through.
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
});
