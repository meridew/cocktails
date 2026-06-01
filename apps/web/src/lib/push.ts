/**
 * Client-side Web Push: ask permission, subscribe this device, register it with
 * the API. Keyed to the anonymous device id — no login needed. Web Push works in
 * browsers + installed PWAs; the native app uses APNs/FCM instead (Phase D), so
 * everything here safely no-ops when PushManager is absent (e.g. iOS WebView).
 */
import type { SubscriberRole } from '@cocktails/shared';
import { getDeviceId } from './device';
import { pushKey, subscribePush } from './api';

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'disabled' | 'denied' | 'error' };

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission {
  return pushSupported() ? Notification.permission : 'denied';
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
 * Request permission + subscribe this device for pushes in the given role.
 * A `token` (staff session) is required for the 'bartender' role — the server
 * downgrades unauthenticated bartender requests to 'guest'.
 */
export async function enablePush(role: SubscriberRole = 'guest', token?: string): Promise<EnableResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const info = await pushKey();
    if (!info.enabled || !info.key) return { ok: false, reason: 'disabled' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    const reg = await navigator.serviceWorker.ready;
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.key),
      }));

    await subscribePush({ deviceId: getDeviceId(), role, subscription: subscription.toJSON() }, token);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
