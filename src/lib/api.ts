import type {
  Handoff,
  NewOrderInput,
  Order,
  OrderStatus,
  ClearWhich,
  SubscriberRole,
  OrderCreatedResponse,
  OrderListResponse,
  OkResponse,
  LoginResponse,
  MeResponse,
  StaffClaimResponse,
  StaffListResponse,
  StaffRequestCreated,
  JoinCodeResponse,
  JoinResponse,
  Staff,
} from '$lib/shared';
import { currentEventId } from './party';

// Same-origin by default: dev → Vite proxy, prod → Caddy, both route /api.
// The native (Capacitor) build has no same-origin server, so it sets
// VITE_API_BASE to the public HTTPS origin (including the /api suffix).
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class Unauthorized extends Error {
  constructor() {
    super('unauthorized');
  }
}

/** The resource is already gone — usually not an error the user needs to see. */
export class NotFound extends Error {
  constructor() {
    super('not found');
  }
}

/**
 * Auth is injected rather than imported, so this module stays the lowest layer
 * (no cycle with the session store) and callers never thread a token through
 * every signature. The session store registers itself once at startup.
 */
let readToken: () => string = () => '';
let handleUnauthorized: () => void = () => {};

export function configureAuth(hooks: { token: () => string; onUnauthorized: () => void }): void {
  readToken = hooks.token;
  handleUnauthorized = hooks.onUnauthorized;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  // Attached whenever a session exists; public endpoints simply ignore it.
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    // network / DNS / offline — never leak a raw "Failed to fetch"
    throw new Error("Can't reach the bar — check your connection.");
  }

  if (res.status === 401) {
    handleUnauthorized(); // one place decides what an expired session means
    throw new Unauthorized();
  }
  if (res.status === 404) throw new NotFound();
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data?.ok === false) {
    throw new Error(
      (data as { error?: string })?.error ?? `Something went wrong (HTTP ${res.status}).`,
    );
  }
  return data;
}

/**
 * Place a round.
 *
 * The party id rides along when this device arrived through a `/e/<id>` link. Left
 * out, the server falls back to the single live event — which keeps a bare visit to
 * the root working while only one party is running.
 */
export const createOrder = (input: NewOrderInput) =>
  req<OrderCreatedResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify({ ...input, eventId: currentEventId() ?? undefined }),
  });

export const listOrders = () => req<OrderListResponse>('/orders');

/**
 * Move an order along. `handoff` is only meaningful when serving, and saying
 * nothing is a valid answer — it keeps the guest's notification neutral.
 */
export const setStatus = (id: string, status: OrderStatus, handoff?: Handoff) =>
  req<{ ok: true; order: Order }>(`/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(handoff ? { status, handoff } : { status }),
  });

export const deleteOrder = (id: string) =>
  req<{ ok: boolean }>(`/orders/${id}`, { method: 'DELETE' });

export const clearOrders = (which: ClearWhich) =>
  req<OkResponse>('/orders/clear', {
    method: 'POST',
    body: JSON.stringify({ which }),
  });

/** Push an order to the front of the queue, or put it back in normal order. */
export const bumpOrder = (id: string, bumped: boolean) =>
  req<{ ok: true; order: Order }>(`/orders/${id}/bump`, {
    method: 'POST',
    body: JSON.stringify({ bumped }),
  });

/** Record how many of one line have been poured (the server clamps to the qty). */
export const setItemProgress = (id: string, index: number, made: number) =>
  req<{ ok: true; order: Order }>(`/orders/${id}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ index, made }),
  });

// ---- host accounts ----

/**
 * Account calls, deliberately **not** routed through `req`.
 *
 * `req` treats a 401 as "your bar session expired" and signs the staff session out.
 * Here a 401 means "wrong password" — and a bartender who mistypes a host password
 * must not be thrown off the queue they're working. Different credential, different
 * failure, different handler.
 *
 * Better Auth authenticates by cookie, which a same-origin fetch sends anyway.
 */
async function account<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/account${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the bar — check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    // Better Auth puts its reason in `message`; it's usually fit to show.
    throw new Error(data?.message || `Something went wrong (HTTP ${res.status}).`);
  }
  return data;
}

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/** `callbackURL` is where the emailed link lands them — back here, not the menu. */
export const signUp = (name: string, email: string, password: string) =>
  account<{ user: AccountUser }>('/sign-up/email', {
    name,
    email,
    password,
    callbackURL: '/host?verified',
  });

export const signInToAccount = (email: string, password: string) =>
  account<{ user: AccountUser }>('/sign-in/email', { email, password });

export const signOutOfAccount = () => account<unknown>('/sign-out', {});

/** Who's signed in, or null. Used to decide which half of /host to render. */
export const currentAccount = () =>
  account<{ user: AccountUser } | null>('/get-session').catch(() => null);

export const resendVerification = (email: string) =>
  account<unknown>('/send-verification-email', { email, callbackURL: '/host?verified' });

/**
 * Start the Google sign-in dance.
 *
 * Better Auth answers with the URL to send the browser to rather than redirecting
 * the fetch, because a 302 on an XHR would be followed invisibly and land the OAuth
 * consent screen inside a JSON parse. The caller navigates.
 */
export const googleSignInUrl = () =>
  account<{ url: string }>('/sign-in/social', { provider: 'google', callbackURL: '/host' });

// ---- the host's own parties ----

export interface Party {
  id: string;
  name: string;
  status: string;
  startsAt: number | null;
  createdAt: number;
}

export const myParties = () => req<{ ok: true; events: Party[] }>('/events');

export const createParty = (name: string) =>
  req<{ ok: true; event: Party }>('/events', { method: 'POST', body: JSON.stringify({ name }) });

/** Trade the account session for a bar session at a party you're staff on. */
export const openBar = (eventId: string) =>
  req<{ ok: true; token: string; staff: Staff }>(`/events/${eventId}/bar`, { method: 'POST' });

// ---- staff auth ----

/**
 * The admin door. There is deliberately no email/password client: the gate is
 * PIN-only, and `POST /api/auth/login` exists purely as break-glass if the PIN
 * throttle is ever jammed — reachable with curl, and covered by the route tests.
 */
export const loginWithPin = (pin: string) =>
  req<LoginResponse>('/auth/pin', { method: 'POST', body: JSON.stringify({ pin }) });

export const logout = () => req<OkResponse>('/auth/logout', { method: 'POST' });

/** Who the current session belongs to — used to recover role/name after a reload. */
export const me = () => req<MeResponse>('/auth/me');

// ---- staff: asking to help, and administering who's in ----

export const requestStaffAccess = (name: string, deviceId: string) =>
  req<StaffRequestCreated>('/staff/requests', {
    method: 'POST',
    body: JSON.stringify({ name, deviceId }),
  });

export const claimStaffAccess = (claim: string) =>
  req<StaffClaimResponse>('/staff/claim', { method: 'POST', body: JSON.stringify({ claim }) });

export const listStaff = () => req<StaffListResponse>('/staff');

export const approveStaff = (id: string) =>
  req<OkResponse>(`/staff/${id}/approve`, { method: 'POST' });

/** Deny a pending request, or remove a helper entirely. */
export const removeStaff = (id: string) => req<OkResponse>(`/staff/${id}`, { method: 'DELETE' });

export const revokeStaff = (id: string) =>
  req<OkResponse>(`/staff/${id}/revoke`, { method: 'POST' });

export const revokeAllHelpers = () => req<OkResponse>('/staff/revoke-all', { method: 'POST' });

// ---- Web Push ----

export const pushKey = () => req<{ ok: true; enabled: boolean; key: string }>('/push/key');

export const subscribePush = (body: {
  deviceId: string;
  role: SubscriberRole;
  subscription: unknown;
}) => req<OkResponse>('/subscriptions', { method: 'POST', body: JSON.stringify(body) });

/** Turn this device off entirely — every role. See the route for why it's a delete. */
export const unsubscribePush = (deviceId: string) =>
  req<OkResponse>('/subscriptions', { method: 'DELETE', body: JSON.stringify({ deviceId }) });

// ---- staff: join codes ----

/** Host mints a code to read out. The plaintext comes back exactly once. */
export const createJoinCode = () => req<JoinCodeResponse>('/staff/join-code', { method: 'POST' });

export const revokeJoinCodes = () => req<OkResponse>('/staff/join-code', { method: 'DELETE' });

/** Helper redeems a code and is working the bar immediately. */
export const joinWithCode = (code: string, name: string, deviceId: string) =>
  req<JoinResponse>('/staff/join', {
    method: 'POST',
    body: JSON.stringify({ code, name, deviceId }),
  });
