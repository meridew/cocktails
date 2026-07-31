/**
 * The staff session: the one owner of the bearer token and its persistence.
 *
 * Previously the token lived in the Bartender component, which meant the storage
 * key (an auth policy) was declared in a UI file, every staff API call took the
 * token as a parameter, and four separate places decided what a 401 meant. Now
 * `api.ts` reads the token through a registered hook, so no signature carries it.
 */
import { ANONYMOUS, type Actor, type Staff } from '$lib/shared';
import {
  configureAuth,
  signInWithPin as pinRequest,
  logout as logoutRequest,
  me as meRequest,
} from '$lib/api';
import { storage } from '$lib/storage';

const TOKEN_KEY = 'staff_token';

let token = $state(storage.read(TOKEN_KEY) ?? '');
let staff = $state<Staff | null>(null);
/**
 * Who the server says we are — the same shape the server's guard reasons about.
 *
 * The client used to decide what to render from `staff.role`, which meant the UI's
 * idea of a permission and the server's were two different pieces of code agreeing
 * by luck. Now both call `can()` on this, so a control that renders is a control the
 * server will honour.
 */
let actor = $state<Actor>(ANONYMOUS);
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
  /** What the server says we are. Feed this to `can()`; never re-derive it here. */
  get actor() {
    return actor;
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

/** Drop the session locally. Internal: the only ways out are a 401 or signOut. */
function invalidateSession(message = ''): void {
  generation += 1;
  token = '';
  staff = null;
  actor = ANONYMOUS;
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

/**
 * Exchange the keypad code for a session, as yourself.
 *
 * The device remembers whose account it is — it signed in properly once — so it
 * says which; this only proves it's still them. Throws on failure and the caller
 * shows why.
 */
export async function signInWithPin(eventId: string, userId: string, pin: string): Promise<void> {
  const result = await pinRequest(eventId, userId, pin);
  adopt(result.token, result.staff);
  await refreshActor();
}

/** Adopt the session an approved helper collected with their claim secret. */
export function adoptApprovedSession(newToken: string, who: Staff): void {
  adopt(newToken, who);
  void refreshActor();
}

/**
 * Ask the server who we are.
 *
 * Never throws and never signs anyone out: "nobody" is a valid answer — a guest
 * asking this is the normal case — so a failure here means we simply hold no
 * powers, which is the safe reading.
 */
export async function refreshActor(): Promise<void> {
  actor = (await meRequest().catch(() => null))?.actor ?? ANONYMOUS;
}

/**
 * Recover who we are after a reload.
 *
 * A reload keeps the token but not what it means, and every control on the screen
 * depends on knowing. Asks unconditionally rather than only when a token exists:
 * an account cookie is a credential too, and someone who signed in on the front
 * door has no bar token at all.
 */
export async function hydrateSession(): Promise<void> {
  await refreshActor();
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
