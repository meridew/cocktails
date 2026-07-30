/**
 * Web Push sender. Delivers to a device's (or a role's) registered
 * subscriptions via VAPID. The per-record `transport` field already routes
 * native tokens (fcm/apns) — those land in Phase D; today only 'webpush' is
 * implemented. Disabled (no-ops) until VAPID keys are configured, so it's safe
 * to deploy before any client subscribes.
 */
import webpush from 'web-push';
import type { SubscriberRole, SubscriptionRecord } from '$lib/shared';
import { config } from './config';
import { deleteSubscription, subscriptionsForDevice, subscriptionsForRole } from './db';

const enabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);
if (enabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

export const pushEnabled = (): boolean => enabled;
export const vapidPublicKey = (): string => config.vapid.publicKey;

export interface PushPayload {
  title: string;
  body: string;
  /** collapse key — a later push with the same tag replaces the earlier one */
  tag?: string;
  /** where to go when tapped (the service worker defaults to the app root) */
  url?: string;
}

/**
 * Hosts we are willing to POST a push to. A subscription endpoint is supplied by
 * an unauthenticated client and is later used as a request target by this server,
 * so without an allow-list it is a blind SSRF primitive — an attacker could point
 * it at an internal address on the NAS network and have us call it.
 */
const PUSH_HOSTS = [
  'android.googleapis.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
] as const;
const PUSH_HOST_SUFFIXES = [
  '.googleapis.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.apple.com',
] as const;

/** True if `endpoint` is an https URL belonging to a known push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return (
    (PUSH_HOSTS as readonly string[]).includes(host) ||
    PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

async function deliver(rec: SubscriptionRecord, payload: PushPayload): Promise<void> {
  if (rec.transport !== 'webpush') return; // fcm/apns: Phase D
  try {
    await webpush.sendNotification(
      rec.subscription as unknown as Parameters<typeof webpush.sendNotification>[0],
      JSON.stringify(payload),
    );
  } catch (err) {
    // 404/410 Gone = the browser dropped this subscription → forget it.
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      deleteSubscription(rec.deviceId, rec.subscription.endpoint);
      return;
    }
    // Anything else is a real fault we would otherwise never see — e.g. a VAPID
    // subject that doesn't match the keys returns 403 on every send, which would
    // silently deliver zero notifications forever.
    const host = URL.canParse(rec.subscription.endpoint)
      ? new URL(rec.subscription.endpoint).host
      : 'unparseable-endpoint';
    console.warn(`push failed (${code ?? 'no status'}) for ${host}: ${(err as Error).message}`);
  }
}

/**
 * Fire-and-forget: notify a device once.
 *
 * A device can hold several rows for one endpoint (one per role), so dedupe by
 * endpoint — otherwise the host, who is both guest and bartender, would get every
 * "your drink" notification twice.
 */
export async function pushToDevice(deviceId: string, payload: PushPayload): Promise<void> {
  if (!enabled || !deviceId) return;
  try {
    const byEndpoint = new Map<string, SubscriptionRecord>();
    for (const record of subscriptionsForDevice(deviceId)) {
      byEndpoint.set(record.subscription.endpoint, record);
    }
    await Promise.all([...byEndpoint.values()].map((s) => deliver(s, payload)));
  } catch {
    /* fire-and-forget: never reject (a DB hiccup here must not crash the request) */
  }
}

/** Fire-and-forget: notify everyone in a role (e.g. all bartenders). */
export async function pushToRole(role: SubscriberRole, payload: PushPayload): Promise<void> {
  if (!enabled) return;
  try {
    await Promise.all(subscriptionsForRole(role).map((s) => deliver(s, payload)));
  } catch {
    /* fire-and-forget: never reject */
  }
}
