/** Web Push registration, reconciliation, diagnostics and self-test. */
import type { NotificationDeviceStatus, NotificationTestStatus, SubscriberRole } from '$lib/shared';
import { getDeviceId } from '$lib/device';
import { storage } from '$lib/storage';
import {
  pushEndpointStatus,
  pushKey,
  pushTestStatus,
  replacePushSubscription,
  sendPushTest,
  subscribePush,
  unsubscribePush,
} from '$lib/api';
import { overrides } from '$lib/devOverrides';

export type PushState = 'idle' | 'working' | 'on' | 'denied' | 'unsupported' | 'disabled' | 'error';

export interface PushDiagnostics {
  permission: NotificationPermission | 'unavailable';
  localSubscription: boolean;
  server: NotificationDeviceStatus | null;
  platform: 'ios' | 'android' | 'web';
}

interface StoredRegistration {
  endpointId: string;
  managementToken: string;
  endpoint: string;
  deviceId: string;
  roles: SubscriberRole[];
  vapidKey: string;
  pendingRefresh: boolean;
}

const ROLES_KEY = 'push_roles';
const DB_NAME = 'cocktails-push';
const DB_STORE = 'registration';
const DB_KEY = 'current';
const states = $state<Record<SubscriberRole, PushState>>({ guest: 'idle', bartender: 'idle' });
let memoryRegistration: StoredRegistration | null = null;
let lifecycleInstalled = false;
let registrationQueue: Promise<void> = Promise.resolve();

export const pushState = (role: SubscriberRole): PushState => states[role];

function browserPushManager(registration: ServiceWorkerRegistration): PushManager {
  const direct = (window as unknown as { pushManager?: PushManager }).pushManager;
  return direct ?? registration.pushManager;
}

export function pushSupported(): boolean {
  const forced = overrides().push;
  if (forced) return forced === 'supported';
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    ('PushManager' in window || 'pushManager' in window) &&
    'Notification' in window
  );
}

function isInstalled(): boolean {
  const forced = overrides().installed;
  if (forced !== undefined) return forced;
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function currentPlatform(): 'ios' | 'android' | 'web' {
  const forced = overrides().platform;
  if (forced === 'ios' || forced === 'android') return forced;
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'web';
}

export function needsInstallFirst(): boolean {
  return currentPlatform() === 'ios' && !isInstalled() && !pushSupported();
}

export function permissionState(): NotificationPermission | 'unavailable' {
  const forced = overrides().permission;
  if (forced) return forced;
  if (typeof Notification === 'undefined') return 'unavailable';
  return Notification.permission;
}

function rememberedRoles(): SubscriberRole[] {
  const raw = storage.readJSON<unknown>(ROLES_KEY, []);
  return Array.isArray(raw)
    ? raw.filter((role): role is SubscriberRole => role === 'guest' || role === 'bartender')
    : [];
}

function rememberRole(role: SubscriberRole): void {
  const roles = new Set(rememberedRoles());
  roles.add(role);
  storage.writeJSON(ROLES_KEY, [...roles]);
}

function openRegistrationDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readRegistration(): Promise<StoredRegistration | null> {
  const db = await openRegistrationDb();
  if (!db) return memoryRegistration;
  return new Promise((resolve) => {
    const request = db.transaction(DB_STORE).objectStore(DB_STORE).get(DB_KEY);
    request.onsuccess = () => resolve((request.result as StoredRegistration | undefined) ?? null);
    request.onerror = () => resolve(memoryRegistration);
  });
}

async function writeRegistration(value: StoredRegistration | null): Promise<void> {
  memoryRegistration = value;
  const db = await openRegistrationDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const store = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE);
    const request = value ? store.put(value, DB_KEY) : store.delete(DB_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function keyMismatch(sub: PushSubscription, serverKey: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return true;
  const expected = urlBase64ToUint8Array(serverKey);
  const actual = new Uint8Array(current);
  return actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i]);
}

async function registerOnce(
  sub: PushSubscription,
  role: SubscriberRole,
  vapidKey: string,
): Promise<void> {
  const previous = await readRegistration();
  const common = { deviceId: getDeviceId(), role, subscription: sub.toJSON() };
  const response =
    previous && (previous.pendingRefresh || previous.endpoint !== sub.endpoint)
      ? await replacePushSubscription({
          ...common,
          endpointId: previous.endpointId,
          managementToken: previous.managementToken,
        })
      : await subscribePush(common);
  const roles = new Set(previous?.roles ?? rememberedRoles());
  roles.add(role);
  await writeRegistration({
    endpointId: response.endpointId,
    managementToken: response.managementToken,
    endpoint: sub.endpoint,
    deviceId: getDeviceId(),
    roles: [...roles],
    vapidKey,
    pendingRefresh: false,
  });
  rememberRole(role);
}

/** Token rotation is sequential even when guest and bartender reconciliation race. */
async function register(
  sub: PushSubscription,
  role: SubscriberRole,
  vapidKey: string,
): Promise<void> {
  const work = registrationQueue.then(() => registerOnce(sub, role, vapidKey));
  registrationQueue = work.catch(() => {});
  return work;
}

async function reconcileRememberedRoles(): Promise<void> {
  for (const role of rememberedRoles()) await refreshPushState(role);
}

function installLifecycleReconciliation(): void {
  if (lifecycleInstalled || typeof document === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  lifecycleInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reconcileRememberedRoles();
  });
  if (typeof navigator.serviceWorker.addEventListener === 'function') {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      void reconcileRememberedRoles();
    });
  }
}

export async function refreshPushState(role: SubscriberRole): Promise<PushState> {
  installLifecycleReconciliation();
  if (!pushSupported()) return (states[role] = 'unsupported');
  try {
    const info = await pushKey();
    if (!info.enabled || !info.key) return (states[role] = 'disabled');
    if (Notification.permission === 'denied') return (states[role] = 'denied');
    const registration = await navigator.serviceWorker.ready;
    const sub = await browserPushManager(registration).getSubscription();
    if (!sub || keyMismatch(sub, info.key)) return (states[role] = 'idle');
    if (!rememberedRoles().includes(role)) return (states[role] = 'idle');
    await register(sub, role, info.key);
    return (states[role] = 'on');
  } catch {
    return (states[role] = 'idle');
  }
}

export async function enablePush(role: SubscriberRole): Promise<PushState> {
  installLifecycleReconciliation();
  if (!pushSupported()) return (states[role] = 'unsupported');
  states[role] = 'working';
  try {
    const info = await pushKey();
    if (!info.enabled || !info.key) return (states[role] = 'disabled');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return (states[role] = 'denied');
    const registration = await navigator.serviceWorker.ready;
    const manager = browserPushManager(registration);
    let sub = await manager.getSubscription();
    if (sub && keyMismatch(sub, info.key)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub ??= await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(info.key),
    });
    await register(sub, role, info.key);
    return (states[role] = 'on');
  } catch {
    return (states[role] = 'error');
  }
}

export async function disablePush(): Promise<void> {
  const stored = await readRegistration();
  try {
    if (stored) await unsubscribePush(stored.endpointId, stored.managementToken);
  } catch {
    /* the provider will invalidate the endpoint after local unsubscribe */
  }
  try {
    if (pushSupported()) {
      const registration = await navigator.serviceWorker.ready;
      await (
        await browserPushManager(registration).getSubscription()
      )
        ?.unsubscribe()
        .catch(() => {});
    }
  } catch {
    /* local cleanup is best effort */
  }
  await writeRegistration(null);
  storage.remove(ROLES_KEY);
  states.guest = 'idle';
  states.bartender = 'idle';
}

export async function enableIfPermitted(role: SubscriberRole): Promise<PushState> {
  if (!pushSupported()) return (states[role] = 'unsupported');
  if (permissionState() !== 'granted') return states[role];
  return enablePush(role);
}

export async function notificationDiagnostics(): Promise<PushDiagnostics> {
  const stored = await readRegistration();
  let localSubscription = false;
  if (pushSupported()) {
    const registration = await navigator.serviceWorker.ready;
    localSubscription = Boolean(await browserPushManager(registration).getSubscription());
  }
  let server: NotificationDeviceStatus | null = null;
  if (stored) {
    server = await pushEndpointStatus(stored.endpointId, stored.managementToken).catch(() => null);
  }
  return { permission: permissionState(), localSubscription, server, platform: currentPlatform() };
}

export async function runNotificationTest(): Promise<NotificationTestStatus> {
  const stored = await readRegistration();
  if (!stored) throw new Error('Turn notifications on before testing this device.');
  const test = await sendPushTest(stored.endpointId, stored.managementToken);
  let latest = await pushTestStatus(test.testId, test.statusToken);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (
      latest.status === 'displayed' ||
      latest.status === 'clicked' ||
      latest.status === 'failed'
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    latest = await pushTestStatus(test.testId, test.statusToken);
  }
  return latest;
}
