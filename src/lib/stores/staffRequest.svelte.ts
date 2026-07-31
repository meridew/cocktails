/**
 * A helper's request to work the bar, from "asked" to "answered".
 *
 * This used to live inside StaffGate, which made the outcome invisible: the claim
 * secret was deleted the moment a decision was read, and "you were declined" was
 * component-local state. So closing the panel — or reloading, or the poll firing
 * while the panel was shut — dropped the person on a bare sign-in screen with no
 * explanation of what had happened to their request. The whole lifecycle is
 * persisted here instead, and it's a store rather than component state because the
 * app shell shows the status too, so you don't have to open the bar to find out.
 *
 * Polling alone can't be the delivery mechanism for the answer: browsers throttle
 * and then freeze timers in a backgrounded tab, which is exactly where a phone in
 * a pocket puts this page. So we also re-check whenever the page becomes visible,
 * and the API pushes the decision to the device.
 */
import { claimStaffAccess, joinWithCode, requestStaffAccess } from '$lib/api';
import { getDeviceId } from '$lib/device';
import { adoptApprovedSession } from '$lib/stores/session.svelte';
import { storage } from '$lib/storage';

const KEY = 'staff_request';
const POLL_MS = 4000;

/**
 * `none`     — nothing outstanding.
 * `pending`  — asked, waiting on the host.
 * `declined` — the host said no, or the request expired. Sticks around until
 *              acknowledged, which is the bug this store exists to fix.
 *
 * There is deliberately no `approved` state. An approval is self-evident — the app
 * is signed in and the queue is on screen — so persisting one would only create a
 * state that outlives its own meaning: a stale "you're approved" banner still
 * showing hours later, long after the session it referred to.
 */
export type RequestKind = 'none' | 'pending' | 'declined';

interface RequestState {
  kind: RequestKind;
  /** The name asked under, so the UI can be specific about whose request this is. */
  name: string;
  /** One-time secret proving this device made the request. Only while pending. */
  claim: string;
  /** epoch ms of the last transition, so we can say "asked 3m ago". */
  at: number;
}

const EMPTY: RequestState = { kind: 'none', name: '', claim: '', at: 0 };

const KINDS: RequestKind[] = ['none', 'pending', 'declined'];

/** A persisted value from an older build must never wedge the UI. */
function load(): RequestState {
  const raw = storage.readJSON<Partial<RequestState>>(KEY, {});
  const kind = KINDS.includes(raw.kind as RequestKind) ? (raw.kind as RequestKind) : 'none';
  // A pending state without its secret can never be resolved, so it isn't pending.
  const claim = typeof raw.claim === 'string' ? raw.claim : '';
  if (kind === 'pending' && !claim) return EMPTY;
  return {
    kind,
    name: typeof raw.name === 'string' ? raw.name : '',
    claim,
    at: typeof raw.at === 'number' ? raw.at : 0,
  };
}

const state = $state<RequestState>(load());
let timer: ReturnType<typeof setInterval> | undefined;
let listening = false;

function set(next: RequestState): void {
  Object.assign(state, next);
  if (next.kind === 'none') storage.remove(KEY);
  else storage.writeJSON(KEY, state);
  // Only a pending request has anything to wait for.
  if (next.kind === 'pending') startWatching();
  else stopWatching();
}

export const staffRequest = {
  get kind() {
    return state.kind;
  },
  get name() {
    return state.name;
  },
  get at() {
    return state.at;
  },
  /** True while something is outstanding or unacknowledged — i.e. worth showing. */
  get active() {
    return state.kind !== 'none';
  },
};

/**
 * Ask to help at a named party.
 *
 * The party is a parameter now rather than "whichever is live": with several
 * running, an inferred one queues you at a stranger's bar. Throws on a
 * network/validation failure so the form can show why.
 */
export async function askToHelp(eventId: string, name: string): Promise<void> {
  const { claim } = await requestStaffAccess(eventId, name, getDeviceId());
  set({ kind: 'pending', name, claim, at: Date.now() });
}

/**
 * Redeem a code the host read out. The fast path: no waiting, no approval.
 * Clears any outstanding request, since this supersedes it.
 */
export async function joinWithJoinCode(eventId: string, code: string, name: string): Promise<void> {
  const result = await joinWithCode(eventId, code, name, getDeviceId());
  adoptApprovedSession(result.token, result.staff);
  set({ ...EMPTY });
}

/**
 * Check once for a decision. Safe to call at any time; a no-op unless pending.
 *
 * A transient failure is swallowed rather than surfaced: the next check — a tick,
 * a tab focus, or reopening the panel — tries again, and "couldn't reach the bar
 * for four seconds" isn't news worth interrupting someone with.
 */
export async function checkDecision(): Promise<void> {
  if (state.kind !== 'pending' || !state.claim) return;
  let result: Awaited<ReturnType<typeof claimStaffAccess>>;
  try {
    result = await claimStaffAccess(state.claim);
  } catch {
    return;
  }
  // Re-check: an approval collected while this request was in flight would already
  // have consumed the claim, and applying a second answer over it would be wrong.
  if (state.kind !== 'pending') return;

  if (result.status === 'active') {
    // Adopt the session *before* clearing, so anything reacting to the state change
    // already sees a signed-in app rather than a signed-out one with no request.
    adoptApprovedSession(result.token, result.staff);
    set({ ...EMPTY });
  } else if (result.status === 'denied') {
    // The server can't distinguish "turned down" from "expired" without letting a
    // caller probe which secrets exist, so the UI covers both.
    set({ ...state, kind: 'declined', claim: '', at: Date.now() });
  }
}

/** Dismiss a finished request: back to a clean slate. */
export function clearRequest(): void {
  set({ ...EMPTY });
}

function startWatching(): void {
  stopWatching();
  timer = setInterval(() => void checkDecision(), POLL_MS);
  if (listening) return;
  // The interval is unreliable by design of the platform, not by accident: a
  // backgrounded page has its timers throttled and eventually frozen. Catching the
  // return to visibility is what makes the answer appear instantly on unlock.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkDecision();
  });
  window.addEventListener('focus', () => void checkDecision());
  listening = true;
}

function stopWatching(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/**
 * Resume watching a request that was outstanding when the app was last closed.
 * Called once at startup — a pending request has to survive a restart, or the
 * person is left waiting on an answer that will never arrive.
 */
export function resumeRequest(): void {
  if (state.kind === 'pending') {
    void checkDecision(); // don't make them wait a full tick
    startWatching();
  }
}
