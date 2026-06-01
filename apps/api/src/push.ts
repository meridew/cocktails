/**
 * Web Push sender. Delivers to a device's (or a role's) registered
 * subscriptions via VAPID. The per-record `transport` field already routes
 * native tokens (fcm/apns) — those land in Phase D; today only 'webpush' is
 * implemented. Disabled (no-ops) until VAPID keys are configured, so it's safe
 * to deploy before any client subscribes.
 */
import webpush from 'web-push';
import type { SubscriberRole, SubscriptionRecord } from '@cocktails/shared';
import { config } from './config.ts';
import { deleteSubscription, subscriptionsForDevice, subscriptionsForRole } from './db.ts';

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
    if (code === 404 || code === 410) deleteSubscription(rec.deviceId, rec.subscription.endpoint);
  }
}

/** Fire-and-forget: notify every subscription for an anonymous device id. */
export async function pushToDevice(deviceId: string, payload: PushPayload): Promise<void> {
  if (!enabled || !deviceId) return;
  try {
    await Promise.all(subscriptionsForDevice(deviceId).map((s) => deliver(s, payload)));
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
