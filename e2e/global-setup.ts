import { ADMIN_EMAIL, PASSWORD, verificationLink } from './people';

/**
 * Register Dan, once, before any worker starts.
 *
 * Every spec that involves a party needs the admin, and there is exactly one admin
 * address — `ADMIN_EMAILS` names it. Ten workers each registering it would be nine
 * races and nine "user already exists" errors, so it happens here instead and the
 * specs only ever sign in.
 *
 * Over HTTP rather than through a browser, because there is nothing to check here —
 * the front-door spec walks registration through the real screens, and this is
 * setup, not a test.
 */
export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';

  // The order in which Playwright starts `webServer` and `globalSetup` is a detail
  // of Playwright's. Waiting on health makes it not matter.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ok = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    if (Date.now() > deadline) throw new Error(`no server at ${base} after 30s`);
    await new Promise((r) => setTimeout(r, 200));
  }

  const res = await fetch(`${base}/api/account/sign-up/email`, {
    method: 'POST',
    // Better Auth refuses a state-changing request with no `Origin` — its CSRF
    // guard, and a browser always sends one. Node's fetch does not, so setup has to
    // say where it is calling from. That the guard is real is worth knowing.
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Dan', email: ADMIN_EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`could not register the admin: ${res.status} ${await res.text()}`);

  // Unverified is refused everywhere, so setup is not done until the link is followed.
  const verify = await fetch(await verificationLink(ADMIN_EMAIL));
  if (!verify.ok) throw new Error(`verifying the admin failed: ${verify.status}`);
}
