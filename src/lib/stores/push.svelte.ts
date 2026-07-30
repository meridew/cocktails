/**
 * Web Push, as one state machine per role.
 *
 * Keyed to the anonymous device id — no login required. Web Push covers browsers
 * and installed PWAs; the native app will use APNs/FCM instead (the server's
 * subscription model already carries a `transport`), so everything here degrades
 * to 'unsupported' where PushManager is absent, e.g. inside the iOS WebView.
 *
 * The state is resolved from the *actual* subscription rather than from
 * `Notification.permission`: permission being granted says nothing about whether
 * this device is registered with the API for a given role, and inferring it from
 * permission made the UI claim "🔔 On" when no subscription existed.
 */
import type { SubscriberRole } from '$lib/shared';
import { getDeviceId } from '$lib/device';
import { storage } from '$lib/storage';
import { pushKey, subscribePush, unsubscribePush } from '$lib/api';
import { overrides } from '$lib/devOverrides';

export type PushState =
  /** not registered yet, but could be */
  | 'idle'
  /** a request is in flight */
  | 'working'
  /** registered with the API for this role */
  | 'on'
  /** the user refused the browser prompt */
  | 'denied'
  /** this browser/WebView has no Push API */
  | 'unsupported'
  /** the server has no VAPID keys configured */
  | 'disabled'
  /** something failed; the button stays available to retry */
  | 'error';

/** Roles this device believes it registered, so state survives a reload. */
const ROLES_KEY = 'push_roles';

const states = $state<Record<SubscriberRole, PushState>>({ guest: 'idle', bartender: 'idle' });

export const pushState = (role: SubscriberRole): PushState => states[role];

export function pushSupported(): boolean {
  const forced = overrides().push;
  if (forced) return forced === 'supported';
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Running as an installed app rather than in a browser tab. */
function isInstalled(): boolean {
  const forced = overrides().installed;
  if (forced !== undefined) return forced;
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS predates the standard and still reports it here only.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS supports Web Push *only* for apps added to the Home Screen — a normal Safari
 * tab has no PushManager at all. So on iPhone the honest answer to "can we notify
 * you" is "install it first", and offering a prompt that cannot appear would just
 * look broken.
 */
export function needsInstallFirst(): boolean {
  const platform = overrides().platform;
  if (typeof navigator === 'undefined' && !platform) return false;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isIOS = platform
    ? platform === 'ios'
    : /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS reports itself as a Mac; the touch points give it away.
      (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return isIOS && !isInstalled() && !pushSupported();
}

/**
 * Whether the browser will actually show a prompt if we ask.
 *
 * `denied` is terminal — the permission cannot be requested again from script, and
 * the only way back is the browser's own site settings. That's why we never ask
 * speculatively; see the opt-in card.
 */
export function permissionState(): NotificationPermission | 'unavailable' {
  const forced = overrides().permission;
  if (forced) return forced;
  if (typeof Notification === 'undefined') return 'unavailable';
  return Notification.permission;
}

function rememberedRoles(): SubscriberRole[] {
  const raw = storage.readJSON<unknown>(ROLES_KEY, []);
  return Array.isArray(raw) ? (raw as SubscriberRole[]) : [];
}

function rememberRole(role: SubscriberRole): void {
  const roles = new Set(rememberedRoles());
  roles.add(role);
  storage.writeJSON(ROLES_KEY, [...roles]);
}

/** VAPID public keys are base64url; the Push API wants an ArrayBuffer-backed view. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * True when an existing subscription was created with a different VAPID key.
 * After a key rotation the old subscription still looks healthy but the server
 * can no longer send to it, so it must be replaced rather than reused.
 */
function keyMismatch(sub: PushSubscription, serverKey: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return true;
  const expected = urlBase64ToUint8Array(serverKey);
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return true;
  return actual.some((byte, i) => byte !== expected[i]);
}

/** Register a subscription with the API for this device + role. */
async function register(sub: PushSubscription, role: SubscriberRole): Promise<void> {
  await subscribePush({ deviceId: getDeviceId(), role, subscription: sub.toJSON() });
  rememberRole(role);
}

/**
 * Reconcile the stored belief with reality, without prompting.
 *
 * If this device previously registered for `role` and still holds a usable
 * subscription, re-register it (the upsert is idempotent) so a pruned or
 * rotated server row heals itself on the next visit.
 */
export async function refreshPushState(role: SubscriberRole): Promise<PushState> {
  if (!pushSupported()) return (states[role] = 'unsupported');
  try {
    const info = await pushKey();
    if (!info.enabled || !info.key) return (states[role] = 'disabled');
    if (Notification.permission === 'denied') return (states[role] = 'denied');

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub || keyMismatch(sub, info.key)) return (states[role] = 'idle');
    if (!rememberedRoles().includes(role)) return (states[role] = 'idle');

    await register(sub, role);
    return (states[role] = 'on');
  } catch {
    return (states[role] = 'idle');
  }
}

/**
 * Ask permission if needed, then subscribe this device for `role`.
 * The API attaches the staff session automatically, so a signed-in bartender is
 * honoured and anyone else is downgraded to 'guest' server-side.
 */
export async function enablePush(role: SubscriberRole): Promise<PushState> {
  if (!pushSupported()) return (states[role] = 'unsupported');
  states[role] = 'working';
  try {
    const info = await pushKey();
    if (!info.enabled || !info.key) return (states[role] = 'disabled');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return (states[role] = 'denied');

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Drop a subscription minted under a different VAPID key — reusing it would
    // silently never deliver again.
    if (sub && keyMismatch(sub, info.key)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(info.key),
    });

    await register(sub, role);
    return (states[role] = 'on');
  } catch {
    return (states[role] = 'error');
  }
}

/**
 * Turn notifications off for this device, everywhere.
 *
 * Drops the browser subscription *and* the server's rows. It deliberately does not
 * try to revoke the permission — browsers don't allow that — so turning it back on
 * later is one tap with no second prompt.
 */
export async function disablePush(): Promise<void> {
  const deviceId = getDeviceId();
  try {
    if (pushSupported()) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe().catch(() => {});
    }
  } catch {
    /* the local subscription is best-effort; the server rows are what matter */
  }
  try {
    await unsubscribePush(deviceId);
  } catch {
    /* offline → the rows outlive us, but nothing is sent while unsubscribed */
  }
  storage.remove(ROLES_KEY);
  states.guest = 'idle';
  states.bartender = 'idle';
}

/**
 * Subscribe a role *without* prompting, for when permission is already granted.
 *
 * This is what makes one opt-in apply everywhere: a guest who said yes at the start
 * and later signs in to the bar should just start receiving order alerts, not meet a
 * second consent step for a permission they already gave.
 */
export async function enableIfPermitted(role: SubscriberRole): Promise<PushState> {
  if (!pushSupported()) return (states[role] = 'unsupported');
  if (permissionState() !== 'granted') return states[role];
  return enablePush(role);
}
