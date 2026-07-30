// @vitest-environment node
/**
 * Host accounts, end to end: sign up → verify → sign in → reset.
 *
 * **Node, not jsdom.** Better Auth signs its tokens with `jose`, which checks
 * `payload instanceof Uint8Array` — and jsdom's `Uint8Array` is a different realm
 * from Node's, so under the suite's default environment every token failed to sign
 * with "payload must be an instance of Uint8Array". Nothing here touches the DOM,
 * so the honest fix is to run it where the globals are real.
 *
 * Driven through the real HTTP surface rather than Better Auth's server API, so
 * this covers the route handler and `hooks.server.ts` too — the same reason the
 * other suites go through `request()`.
 *
 * Email is captured rather than sent. That is not a shortcut around a missing
 * mailbox: the verification link is the thing under test, and reading it out of
 * the captured message is exactly what a person does with their inbox.
 */
import { test, describe, beforeAll, expect } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { memorySender, setEmailSender } from '$lib/server/email';
import { resetAccounts } from '$lib/server/accounts';
import { orm } from '$lib/server/db';
import { user } from '$lib/server/schema.auth';

const mail = memorySender();

const HOST = {
  name: 'Priya',
  email: 'priya@example.com',
  password: 'a-long-enough-password',
};

/** The first link in the most recent message. */
function latestLink(): URL {
  const last = mail.sent.at(-1);
  assert.ok(last, 'no email was sent');
  const found = last.text.match(/https?:\/\/\S+/);
  assert.ok(found, `no link in the message:\n${last.text}`);
  return new URL(found[0]);
}

/** Follow a link from an email through our own routes. */
const follow = (link: URL) => request(link.pathname + link.search);

/**
 * The token out of an emailed link.
 *
 * Verification puts it in the query; the reset link puts it in the path, because
 * that URL points at a *page* the host lands on, which then posts the token back.
 * Handling both keeps this honest about what the library actually sends.
 */
function tokenFrom(link: URL): string {
  const fromQuery = link.searchParams.get('token');
  if (fromQuery) return fromQuery;
  const last = link.pathname.split('/').filter(Boolean).at(-1);
  assert.ok(last, `no token in ${link.href}`);
  return last;
}

beforeAll(() => {
  setEmailSender(mail);
  resetAccounts(); // so the instance picks up the sender above
});

describe('signing up', () => {
  test('creates the account and sends a verification email', async () => {
    const res = await request('/api/account/sign-up/email', send('POST', HOST));
    assert.equal(res.status, 200, await res.text());

    const sent = mail.sent.at(-1);
    assert.equal(sent?.to, HOST.email);
    assert.match(sent!.subject, /confirm/i);
    assert.ok(latestLink().searchParams.get('token'), 'the link must carry a token');
  });

  test('an unverified account cannot sign in', async () => {
    // The whole point of requiring verification: an address nobody has proved they
    // own must not become a working login.
    const res = await request(
      '/api/account/sign-in/email',
      send('POST', { email: HOST.email, password: HOST.password }),
    );
    assert.notEqual(res.status, 200, 'unverified sign-in should be refused');
  });

  test('signing up twice does not create a second account', async () => {
    // Better Auth answers a repeat sign-up for an *unverified* address with 200 and
    // another verification mail, rather than an error — deliberately, since "I lost
    // the email" is far more common than an attack, and erroring would also turn
    // this into an oracle for which addresses exist. So the invariant to assert is
    // the row count, not the status code.
    await request('/api/account/sign-up/email', send('POST', HOST));
    const rows = orm().select().from(user).all();
    assert.equal(rows.length, 1, 'a duplicate sign-up created a second user');
  });
});

describe('verifying, then signing in', () => {
  test('following the emailed link verifies the address', async () => {
    // Re-send so this test owns its own token rather than depending on the order
    // the suite happens to run in.
    await request('/api/account/send-verification-email', send('POST', { email: HOST.email }));
    const res = await follow(latestLink());
    // Better Auth redirects after verifying; either is a pass, a 4xx is not.
    assert.ok(res.status < 400, `verification failed: ${res.status} ${await res.text()}`);
  });

  test('and then the password works', async () => {
    const res = await request(
      '/api/account/sign-in/email',
      send('POST', { email: HOST.email, password: HOST.password }),
    );
    // Read the body once — a Response body is a stream, so consuming it for an
    // assertion message and again for JSON throws "Body has already been read".
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text) as { user?: { email: string; emailVerified: boolean } };
    assert.equal(body.user?.email, HOST.email);
    assert.equal(body.user?.emailVerified, true);
  });

  test('the wrong password does not', async () => {
    const res = await request(
      '/api/account/sign-in/email',
      send('POST', { email: HOST.email, password: 'not-the-password' }),
    );
    assert.notEqual(res.status, 200);
  });
});

describe('resetting a forgotten password', () => {
  const NEW_PASSWORD = 'an-entirely-different-password';

  test('asking for a reset sends a link', async () => {
    const before = mail.sent.length;
    const res = await request(
      '/api/account/request-password-reset',
      send('POST', { email: HOST.email, redirectTo: '/bar' }),
    );
    assert.equal(res.status, 200, await res.text());
    expect(mail.sent.length).toBeGreaterThan(before);
    assert.match(mail.sent.at(-1)!.subject, /reset/i);
  });

  test('an unknown address is answered identically', async () => {
    // Otherwise the endpoint is an oracle for which addresses have accounts.
    const res = await request(
      '/api/account/request-password-reset',
      send('POST', { email: 'nobody@example.com' }),
    );
    assert.equal(res.status, 200, 'must not reveal whether the account exists');
  });

  test('the token sets a new password, and the old one stops working', async () => {
    await request('/api/account/request-password-reset', send('POST', { email: HOST.email }));
    const token = tokenFrom(latestLink());

    const reset = await request(
      '/api/account/reset-password',
      send('POST', { newPassword: NEW_PASSWORD, token }),
    );
    assert.equal(reset.status, 200, await reset.text());

    const withNew = await request(
      '/api/account/sign-in/email',
      send('POST', { email: HOST.email, password: NEW_PASSWORD }),
    );
    assert.equal(withNew.status, 200, 'the new password should work');

    const withOld = await request(
      '/api/account/sign-in/email',
      send('POST', { email: HOST.email, password: HOST.password }),
    );
    assert.notEqual(withOld.status, 200, 'the old password must be dead');
  });
});
