/**
 * People, parties and the credentials that go with them.
 *
 * Every suite used to build its own by poking `createStaff` with a role and a
 * password hash. That worked while a staff row *was* an identity; it isn't one any
 * more — identity lives on an account, and a staff row is just a shift. So there is
 * one place that knows how to make each kind of person, and it makes them the way
 * the app does.
 *
 * Deliberately goes through the **real HTTP surface** for anything a person actually
 * does: an admin signs in, a helper redeems a code. Fabricating session rows would
 * test this file rather than the system, and the isolation suites exist precisely to
 * catch the cases where the real path differs from the convenient one.
 */
import assert from 'node:assert/strict';
import { request, send } from '../app';
import { memorySender, setEmailSender } from '$lib/server/email';
import { resetAccounts } from '$lib/server/accounts';
import { createEvent, setGuestStatus, setUserRole, userByEmail } from '$lib/server/db';

/** Captured outbound mail, so verification links can be followed like a person would. */
export const mail = memorySender();

/** Call once per suite, before building anybody. */
export function useMemoryEmail(): void {
  setEmailSender(mail);
  resetAccounts();
}

export interface Account {
  id: string;
  email: string;
  /** Better Auth's session cookie, carried exactly as a browser would. */
  cookie: string;
}

/** Follow the verification link out of the most recent message. */
async function verifyLatest(): Promise<void> {
  const last = mail.sent.at(-1);
  assert.ok(last, 'no verification email was sent');
  const link = last.text.match(/https?:\/\/\S+/);
  assert.ok(link, 'no link in the verification email');
  const url = new URL(link[0]);
  const res = await request(url.pathname + url.search);
  assert.ok(res.status < 400, `verification failed: ${res.status}`);
}

/**
 * Register, verify and sign in — the whole front door, as a person walks it.
 *
 * `role` is applied *after* sign-up on purpose: nothing a sign-up payload contains
 * may set it, and `accounts.test.ts` proves that. Here it stands in for
 * `ADMIN_EMAILS`, which config owns.
 */
export async function person(label: string, role: 'admin' | 'host' = 'host'): Promise<Account> {
  const email = `${label}@example.com`;
  const password = `${label}-password-123`;

  const signUp = await request(
    '/api/account/sign-up/email',
    send('POST', { name: label, email, password }),
  );
  assert.equal(signUp.status, 200, `sign up ${label} → ${signUp.status}`);
  await verifyLatest();

  const row = userByEmail(email);
  assert.ok(row, `${label} should exist after signing up`);
  if (role === 'admin') setUserRole(row.id, 'admin');

  const signIn = await request('/api/account/sign-in/email', send('POST', { email, password }));
  assert.equal(signIn.status, 200, `sign in ${label} → ${signIn.status}`);
  const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(cookie, 'sign-in should have set a session cookie');

  return { id: row.id, email, cookie };
}

/** Headers for a request made as an account holder. */
export const asAccount = (a: Account) => ({ cookie: a.cookie });

/** Headers for a request made with a bar session. */
export const asBar = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * A party belonging to a host.
 *
 * Created directly rather than through the endpoint, because most suites want a
 * party to exist and only `events.test.ts` cares how one comes into being.
 */
export function partyFor(hostUserId: string, name = 'the party', status = 'live'): string {
  return createEvent({ hostUserId, name, status }).id;
}

/** A bar session at a party, taken by someone entitled to work it. */
export async function barToken(a: Account, eventId: string): Promise<string> {
  const res = await request(`/api/events/${eventId}/bar`, {
    ...send('POST', {}),
    headers: { 'Content-Type': 'application/json', ...asAccount(a) },
  });
  assert.equal(res.status, 200, `open bar at ${eventId} → ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/**
 * A helper with no account at all, let in the way a real one is: an admin reads out
 * a code and they redeem it. Minting their session directly would skip the only path
 * that actually exists for them.
 */
export async function helper(
  admin: Account,
  eventId: string,
  name: string,
  deviceId: string,
): Promise<string> {
  const adminToken = await barToken(admin, eventId);
  const minted = await request('/api/staff/join-code', {
    method: 'POST',
    headers: asBar(adminToken),
  });
  assert.equal(minted.status, 200, 'admin should be able to mint a join code');
  const { code } = (await minted.json()) as { code: string };

  const joined = await request('/api/staff/join', send('POST', { eventId, code, name, deviceId }));
  assert.equal(joined.status, 200, 'the code should let a helper in');
  return ((await joined.json()) as { token: string }).token;
}

/**
 * A guest orders, and the bar lets them in.
 *
 * **Admission is a real gate now**, so "place an order" and "an order the bar can
 * see" stopped being the same thing. A guest is admitted per device; until somebody
 * admits them their round sits in the waiting room and `GET /api/orders` does not
 * show it.
 *
 * Nearly every suite that posts an order is testing something *downstream* of it —
 * the status chain, the queue, throttling — and wants an ordinary admitted guest.
 * This is that guest. A suite testing the gate itself should place the order by hand
 * and not call this.
 *
 * The device id is unique per call, so two orders from "the same" test are two
 * guests, which is what two people at a party are.
 */
let guestSeq = 0;
export async function guestOrder(
  eventId: string,
  input: { name: string; items: { name: string; qty: number }[]; note?: string },
): Promise<{ id: string; deviceId: string }> {
  const deviceId = `dev-guest-${(guestSeq++).toString(36)}`;
  const res = await request('/api/orders', send('POST', { ...input, eventId, deviceId }));
  assert.equal(res.status, 200, `order for ${input.name} → ${res.status}`);
  admitGuest(eventId, deviceId);
  return { id: ((await res.json()) as { id: string }).id, deviceId };
}

/**
 * Let a device in, straight through the data layer.
 *
 * Deliberately *not* over HTTP: this is setup for suites about something else, and
 * routing it through the endpoint would make every one of them depend on the
 * admission API's shape. `guests.test.ts` drives the real endpoint.
 */
export function admitGuest(eventId: string, deviceId: string): void {
  setGuestStatus(eventId, deviceId, 'admitted');
}
