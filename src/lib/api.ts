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
  MeResponse,
  StaffClaimResponse,
  StaffListResponse,
  StaffRequestCreated,
  Staff,
  PartySettings,
  PartySounds,
  SoundCue,
} from '$lib/shared';
import { currentEventId } from './party';

// Same-origin by default: dev → Vite proxy, prod → Caddy, both route /api.
// The native (Capacitor) build has no same-origin server, so it sets
// VITE_API_BASE to the public HTTPS origin (including the /api suffix).
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

const inParty = (path: string, eventId: string): string =>
  `${path}?eventId=${encodeURIComponent(eventId)}`;

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

/**
 * The queue.
 *
 * A bar session names its own party, so the bar passes nothing. An account holder
 * has no such session — a host watching their own night, or Dan at a laptop — so
 * they say which party they mean. The server refuses either way if they may not see
 * it; naming a party is not permission to read it.
 */
export const listOrders = (eventId?: string) =>
  req<OrderListResponse>(eventId ? inParty('/orders', eventId) : '/orders');

/**
 * Move an order along. `handoff` is only meaningful when serving, and saying
 * nothing is a valid answer — it keeps the guest's notification neutral.
 */
export const setStatus = (id: string, eventId: string, status: OrderStatus, handoff?: Handoff) =>
  req<{ ok: true; order: Order }>(inParty(`/orders/${id}`, eventId), {
    method: 'PATCH',
    body: JSON.stringify(handoff ? { status, handoff } : { status }),
  });

export const deleteOrder = (id: string, eventId: string) =>
  req<{ ok: boolean }>(inParty(`/orders/${id}`, eventId), { method: 'DELETE' });

export const clearOrders = (eventId: string, which: ClearWhich) =>
  req<OkResponse>(inParty('/orders/clear', eventId), {
    method: 'POST',
    body: JSON.stringify({ which }),
  });

/** Push an order to the front of the queue, or put it back in normal order. */
export const bumpOrder = (id: string, eventId: string, bumped: boolean) =>
  req<{ ok: true; order: Order }>(inParty(`/orders/${id}/bump`, eventId), {
    method: 'POST',
    body: JSON.stringify({ bumped }),
  });

/**
 * Let in — or turn away — whoever placed this drink.
 *
 * Keyed on the order because that is what the bar is looking at; the device id
 * behind it stays a server concept. Admission is per guest, so this releases
 * everything they have ordered and everything they order later tonight.
 */
export const admitOrderGuest = (id: string, eventId: string, block = false) =>
  req<{ ok: true; blocked: boolean }>(inParty(`/orders/${id}/admit`, eventId), {
    method: 'POST',
    body: JSON.stringify({ block }),
  });

/** Let everyone still waiting in, for a room that arrived together. */
export const admitEveryone = (eventId: string) =>
  req<{ ok: true; admitted: number }>(`/events/${eventId}/guests`, { method: 'PATCH' });

/**
 * A guest gives their name once, on arrival.
 *
 * Answers the same thing whether they are new, waiting or long since admitted — the
 * gate is one the guest cannot perceive, so there is nothing here to read.
 */
export const joinParty = (eventId: string, name: string, deviceId: string) =>
  req<{ ok: true }>(`/events/${eventId}/guests`, {
    method: 'POST',
    body: JSON.stringify({ name, deviceId }),
  });

/**
 * Send the picture itself — only when a join said this party hasn't got it.
 *
 * Split from joining because joining happens on every menu load. Uploading an
 * unchanged image each time would be the point of hashing it thrown away.
 */
export const putGuestPhoto = (
  eventId: string,
  deviceId: string,
  photo: string | null,
  photoId: string | null,
) =>
  req<{ ok: true }>(`/events/${eventId}/guests/photo`, {
    method: 'PUT',
    body: JSON.stringify({ deviceId, photo, photoId }),
  });

/**
 * One face, by content hash, for the bar.
 *
 * Returns a data URL rather than bytes: a bar session is a bearer token, which an
 * `<img src>` cannot send, so the alternative was making these public behind an
 * unguessable URL. They are photographs of somebody's friends — the guard stays and
 * `Avatar.svelte` fetches them properly, once each, because a content hash can never
 * come back a different picture.
 */
export const guestPhoto = (eventId: string, photoId: string) =>
  req<{ ok: true; photo: string }>(
    `/events/${eventId}/guests/photo?id=${encodeURIComponent(photoId)}`,
  ).then((r) => r.photo);

/** What's on tonight. Public: id and name of every live party, and nothing else. */
export const liveParties = () =>
  req<{ ok: true; parties: { id: string; name: string }[] }>('/parties');

/** Record how many of one line have been poured (the server clamps to the qty). */
export const setItemProgress = (id: string, eventId: string, index: number, made: number) =>
  req<{ ok: true; order: Order }>(inParty(`/orders/${id}/progress`, eventId), {
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

/** `callbackURL` is where the emailed link lands them: the front door, which routes
 *  them on to wherever they belong once it knows what they are. */
export const signUp = (name: string, email: string, password: string) =>
  account<{ user: AccountUser }>('/sign-up/email', {
    name,
    email,
    password,
    callbackURL: '/?verified',
  });

export const signInToAccount = (email: string, password: string) =>
  account<{ user: AccountUser }>('/sign-in/email', { email, password });

export const signOutOfAccount = () => account<unknown>('/sign-out', {});

/** Who's signed in, or null. Used to decide which half of /host to render. */
export const currentAccount = () =>
  account<{ user: AccountUser } | null>('/get-session').catch(() => null);

export const resendVerification = (email: string) =>
  account<unknown>('/send-verification-email', { email, callbackURL: '/?verified' });

/**
 * Start the Google sign-in dance.
 *
 * Better Auth answers with the URL to send the browser to rather than redirecting
 * the fetch, because a 302 on an XHR would be followed invisibly and land the OAuth
 * consent screen inside a JSON parse. The caller navigates.
 */
export const googleSignInUrl = () =>
  account<{ url: string }>('/sign-in/social', { provider: 'google', callbackURL: '/' });

// ---- the host's own parties ----

export interface Party {
  id: string;
  /** Whose party it is. Admin's list spans hosts, so the row has to say. */
  hostUserId: string;
  name: string;
  status: 'draft' | 'live' | 'done';
  startsAt: number | null;
  /** Parsed by `$lib/server/party`'s `onWire`, never the raw column. */
  settings: PartySettings;
  createdAt: number;
}

/**
 * The parties you can see: **all of them if you're Admin, your own if you're a host.**
 * The server decides which; there is no separate admin endpoint because "see your
 * own things" is not a permission, it is what the list is.
 */
export const myParties = () => req<{ ok: true; events: Party[] }>('/events');

/**
 * One party, for a screen that is *about* one party.
 *
 * Guarded by `orders:read`, which is exactly the set of people who can be standing
 * on `/bar/<id>`: Dan, its host, and whoever is working it. That makes it the right
 * way for the bar to learn its own name — and a 404 here is the honest answer to
 * "this isn't your bar", rather than the screen silently flipping to a sign-in gate
 * with nothing said, which is what reading the party out of device storage did.
 */
export const partyById = (eventId: string) => req<{ ok: true; event: Party }>(`/events/${eventId}`);

/** Admin only: a party is created *for* a host, who must already have an account. */
export const createParty = (hostUserId: string, name: string, startsAt?: number | null) =>
  req<{ ok: true; event: Party }>('/events', {
    method: 'POST',
    body: JSON.stringify({ hostUserId, name, startsAt: startsAt ?? null }),
  });

/** Trade the account session for a bar session at a party you're staff on. */
export const openBar = (eventId: string) =>
  req<{ ok: true; token: string; staff: Staff }>(`/events/${eventId}/bar`, { method: 'POST' });

// ---- what the host has in ----

/** A recipe as the stock screen lists it — enough to name it, nothing more. */
export interface Pourable {
  id: string;
  name: string;
  base: string;
}

export interface StockView {
  /** Everything tickable, so the screen needs no second source for the list. */
  stockable: string[];
  stock: string[];
  makeable: Pourable[];
  /** What one more bottle would unlock, best first. */
  suggestions: { ingredient: string; unlocks: number }[];
}

export const getStock = (userId: string) => req<{ ok: true } & StockView>(`/hosts/${userId}/stock`);

/**
 * Replace the whole list rather than toggling one bottle.
 *
 * Matches the endpoint, and for the same reason: a request per tick would make the
 * makeable count flicker through states the host never chose.
 */
export const saveStock = (userId: string, stock: string[]) =>
  req<{ ok: true; stock: string[]; makeable: Pourable[] }>(`/hosts/${userId}/stock`, {
    method: 'PUT',
    body: JSON.stringify({ stock }),
  });

/**
 * What a party can pour, for the guest menu. Public — a menu is not a secret.
 *
 * Not routed through `req`'s auth at all in spirit: guests are anonymous, and the
 * endpoint ignores the header if one happens to be attached.
 */
export interface MenuItem {
  id: string;
  name: string;
  base: string;
  blurb?: string;
  glass?: string;
  garnish?: string;
}

export interface EventMenu {
  ok: true;
  /** `status` is here so the menu can say the bar is shut before a round is built. */
  event: { id: string; name: string; status: 'draft' | 'live' | 'done' };
  /** `cupboard` when generated from what the host has in; `house` when they never said. */
  source: 'cupboard' | 'house';
  recorded: boolean;
  items: MenuItem[];
  /** Recipe ids to lead with. Empty means show everything. */
  shortList: string[];
  /** Which extras this party offers. Rides here so the menu poll carries changes. */
  settings: PartySettings;
  /** Enabled take ids per cue — see `$lib/sound`. Ids only; the audio is fetched. */
  sounds: PartySounds;
  /** The host's ingredients, so "help me choose" can run without a round trip. */
  stock: string[];
}

export const eventMenu = (eventId: string) => req<EventMenu>(`/events/${eventId}/menu`);

/** Choose what a party leads with. An empty list is a real answer: feature nothing. */
export const setShortList = (eventId: string, recipes: string[]) =>
  req<{ ok: true; shortList: string[] }>(`/events/${eventId}/menu`, {
    method: 'PUT',
    body: JSON.stringify({ recipes }),
  });

/**
 * Turn a menu extra on or off. Partial by design — send the one that changed and
 * the server lays it over what's stored, so two open tabs can't undo each other.
 */
export const setPartySettings = (eventId: string, settings: Partial<PartySettings>) =>
  req<{ ok: true; settings: PartySettings }>(`/events/${eventId}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });

// ---- the noises a party makes ----

/** One recorded take, as the host's list sees it. The audio is fetched separately. */
export interface Take {
  id: string;
  eventId: string;
  cue: string;
  label: string;
  enabled: boolean;
  createdAt: number;
}

/** Every take at a party, on or off. Host-only; guests get ids on the menu payload. */
export const listTakes = (eventId: string) =>
  req<{ ok: true; sounds: Take[] }>(`/events/${eventId}/sounds`);

/** Keep a recording. Arrives enabled — they just made it on purpose. */
export const addTake = (eventId: string, cue: SoundCue, audio: string, label?: string) =>
  req<{ ok: true; id: string }>(`/events/${eventId}/sounds`, {
    method: 'POST',
    body: JSON.stringify({ cue, audio, label }),
  });

/** Park a take without losing it. A cue falls silent when nothing of its is on. */
export const setTakeEnabled = (eventId: string, id: string, enabled: boolean) =>
  req<OkResponse>(`/events/${eventId}/sounds/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });

export const deleteTake = (eventId: string, id: string) =>
  req<OkResponse>(`/events/${eventId}/sounds/${id}`, { method: 'DELETE' });

/**
 * Where one clip's bytes live. **Not a `req` call** — this is a URL, handed to an
 * `<audio>` element rather than fetched, so the browser streams and caches it.
 *
 * It still goes through `BASE`, and that is not decoration: this wrote `/api/…`
 * literally at first, which is identical while the app and its API share an origin
 * and silently wrong the moment `VITE_API_BASE` points elsewhere — every request in
 * the app would follow it and the sounds alone would 404, on the one build nobody
 * tests locally.
 */
export const takeAudioUrl = (eventId: string, id: string): string =>
  `${BASE}/events/${eventId}/sounds/${id}/audio`;

// ---- admin: the people and their parties ----

export interface Host {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: 'admin' | 'host';
  bannedAt: number | null;
  banReason: string | null;
  createdAt: number;
  hasStock: boolean;
  parties: number;
  /** Admin because `ADMIN_EMAILS` says so — the app cannot demote them. */
  adminByConfig: boolean;
}

export const listHosts = () => req<{ ok: true; hosts: Host[] }>('/hosts');

export const getHost = (id: string) => req<{ ok: true; host: Host }>(`/hosts/${id}`);

/** Suspend, reinstate, promote or demote. Each field is its own capability. */
export const updateHost = (
  id: string,
  changes: { banned?: boolean; reason?: string; role?: 'admin' | 'host' },
) =>
  req<{ ok: true; host: Host }>(`/hosts/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const deleteHost = (id: string) => req<OkResponse>(`/hosts/${id}`, { method: 'DELETE' });

/** Rename, re-date, open or close. Opening and closing are separate capabilities. */
export const updateParty = (
  id: string,
  changes: { name?: string; startsAt?: number | null; status?: 'draft' | 'live' | 'done' },
) =>
  req<{ ok: true; event: Party }>(`/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });

export const deleteParty = (id: string) => req<OkResponse>(`/events/${id}`, { method: 'DELETE' });

// ---- staff auth ----

export const logout = () => req<OkResponse>('/auth/logout', { method: 'POST' });

/**
 * Who we are, as the server sees us. Never 401s — "nobody" is a real answer, and
 * the signed-out front door asks this too.
 */
export const me = () => req<MeResponse>('/auth/me');

// ---- staff: asking to help, and administering who's in ----

export const requestStaffAccess = (eventId: string, name: string, deviceId: string) =>
  req<StaffRequestCreated>('/staff/requests', {
    method: 'POST',
    body: JSON.stringify({ eventId, name, deviceId }),
  });

export const claimStaffAccess = (claim: string) =>
  req<StaffClaimResponse>('/staff/claim', { method: 'POST', body: JSON.stringify({ claim }) });

/**
 * **Every one of these names its party**, and that was a real hole rather than tidying.
 *
 * All five endpoints go through `requirePartyInScope`, which takes the party from a
 * **bar session token** or from `?eventId=` and answers 400 "which party?" with
 * neither. These calls sent neither — so they worked for a helper (who always holds a
 * token) and failed for an **account-holder who had not taken one**, which is exactly
 * Dan opening `/bar/<id>` from a link, a bookmark or the guest menu rather than
 * through "Work it".
 *
 * The failure was silent and the consequence was the whole point of the screen:
 * `fetchStaff` swallows the error, so the staff list came back empty, the pending-request
 * dot never appeared, and **a helper who asked to serve was invisible**. `listOrders`
 * had always passed its id; these had drifted.
 */
export const listStaff = (eventId: string) =>
  req<StaffListResponse>(`/staff?eventId=${encodeURIComponent(eventId)}`);

export const approveStaff = (id: string, eventId: string) =>
  req<OkResponse>(`/staff/${id}/approve?eventId=${encodeURIComponent(eventId)}`, {
    method: 'POST',
  });

/** Deny a pending request, or remove a helper entirely. */
export const removeStaff = (id: string, eventId: string) =>
  req<OkResponse>(`/staff/${id}?eventId=${encodeURIComponent(eventId)}`, { method: 'DELETE' });

export const revokeStaff = (id: string, eventId: string) =>
  req<OkResponse>(`/staff/${id}/revoke?eventId=${encodeURIComponent(eventId)}`, { method: 'POST' });

export const revokeAllHelpers = (eventId: string) =>
  req<OkResponse>(`/staff/revoke-all?eventId=${encodeURIComponent(eventId)}`, { method: 'POST' });

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
