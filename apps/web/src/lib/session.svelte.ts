/**
 * The staff session: the one owner of the bearer token and its persistence.
 *
 * Previously the token lived in the Bartender component, which meant the storage
 * key (an auth policy) was declared in a UI file, every staff API call took the
 * token as a parameter, and four separate places decided what a 401 meant. Now
 * `api.ts` reads the token through a registered hook, so no signature carries it.
 */
import type { Staff } from '@cocktails/shared';
import {
  configureAuth,
  login as loginRequest,
  logout as logoutRequest,
  me as meRequest,
} from './api.ts';
import { storage } from './storage.ts';

const TOKEN_KEY = 'staff_token';

let token = $state(storage.read(TOKEN_KEY) ?? '');
let staff = $state<Staff | null>(null);
let expiredMessage = $state('');
/**
 * Bumped whenever the session drops. Long-running work (the bartender poll, an
 * in-flight mutation) captures this and discards its result if it changed, so a
 * response landing after sign-out can't resurrect the signed-in view.
 */
let generation = $state(0);

export const session = {
  get token() {
    return token;
  },
  get staff() {
    return staff;
  },
  get signedIn() {
    return token !== '';
  },
  /** Why the session ended, for the sign-in form to show. Cleared on success. */
  get expiredMessage() {
    return expiredMessage;
  },
  get generation() {
    return generation;
  },
};

/** Drop the session locally. Safe to call from anywhere, including an API 401. */
export function invalidateSession(message = ''): void {
  generation += 1;
  token = '';
  staff = null;
  expiredMessage = message;
  storage.remove(TOKEN_KEY);
}

// api.ts is the lowest layer and must not import this module, so hand it the
// accessors instead. A 401 anywhere now ends the session exactly once.
configureAuth({
  token: () => token,
  onUnauthorized: () => {
    if (token !== '') invalidateSession('Session expired — sign in again.');
  },
});

/** Adopt a freshly-issued session. */
function adopt(newToken: string, who: Staff): void {
  token = newToken;
  staff = who;
  expiredMessage = '';
  storage.write(TOKEN_KEY, token);
}

/** Exchange credentials for a session. Throws on failure; the caller shows why. */
export async function signIn(email: string, password: string): Promise<void> {
  const result = await loginRequest(email.trim(), password);
  adopt(result.token, result.staff);
}

/** Adopt the session an approved helper collected with their claim secret. */
export function adoptApprovedSession(newToken: string, who: Staff): void {
  adopt(newToken, who);
}

/**
 * Recover who we are after a reload. The token survives in storage but `staff`
 * doesn't, and the UI needs the role to know whether to show admin controls.
 * A 401 here is handled by api.ts, which ends the session.
 */
export async function hydrateSession(): Promise<void> {
  if (token === '' || staff !== null) return;
  try {
    staff = (await meRequest()).staff;
  } catch {
    /* invalid token → api.ts has already ended the session; the gate will show */
  }
}

/**
 * End the session. Order matters: start the request *first* so it picks up the
 * still-valid token, then clear locally so the UI responds immediately. Clearing
 * first would send an unauthenticated logout and leave the server row behind.
 */
export async function signOut(): Promise<void> {
  if (token === '') {
    invalidateSession();
    return;
  }
  const pending = logoutRequest().catch(() => {
    /* best effort — the server row expires on its own */
  });
  invalidateSession();
  await pending;
}
