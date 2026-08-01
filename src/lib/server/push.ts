/** Durable Web Push delivery and its in-process leased worker. */
import webpush from 'web-push';
import { dbTransaction, now } from './db';
import { config } from './config';
import { declarativePayload } from './notify';
import {
  claimDeliveries,
  deliveriesForShadow,
  deliveryForSend,
  expireQueuedDeliveries,
  markDeliveryAccepted,
  markDeliveryTerminal,
  pruneNotificationData,
  receiptTokenForDelivery,
  rescheduleDelivery,
  startDeliveryAttempt,
  subscriptionForDelivery,
} from './notification-store';

const enabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);
if (enabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

export const pushEnabled = (): boolean => enabled;
export const vapidPublicKey = (): string => config.vapid.publicKey;

const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 8;
const MAX_RETRY_AGE_MS = 60 * 60 * 1000;
const WORKER_INTERVAL_MS = 1_000;
const CLAIM_SIZE = 20;
const CONCURRENCY = 4;

/**
 * Hosts we are willing to POST a push to. A subscription endpoint is supplied by
 * an unauthenticated client and is later used as a request target by this server,
 * so without an allow-list it is a blind SSRF primitive.
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

export type PushFailureAction =
  | { kind: 'invalidate'; code: string }
  | { kind: 'permanent'; code: string }
  | { kind: 'retry'; code: string; retryAfterMs: number | null };

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  return typeof value === 'string' ? value : null;
}

export function parseRetryAfter(value: string | null, at = now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - at) : null;
}

export function classifyPushFailure(error: unknown, at = now()): PushFailureAction {
  const detail = error as { statusCode?: number; headers?: unknown; code?: string };
  const status = detail?.statusCode;
  if (status === 404 || status === 410) return { kind: 'invalidate', code: `http-${status}` };
  if (status === 400 || status === 401 || status === 403 || status === 413) {
    return { kind: 'permanent', code: `http-${status}` };
  }
  if (status === 429) {
    return {
      kind: 'retry',
      code: 'http-429',
      retryAfterMs: parseRetryAfter(headerValue(detail.headers, 'retry-after'), at),
    };
  }
  if (status && status >= 500) {
    return { kind: 'retry', code: `http-${status}`, retryAfterMs: null };
  }
  if (!status) {
    return {
      kind: 'retry',
      code: detail?.code ? `network-${detail.code}` : 'network',
      retryAfterMs: null,
    };
  }
  return { kind: 'permanent', code: `http-${status}` };
}

/** Full jitter bounded between ten seconds and five minutes. */
export function retryDelayMs(attempt: number, random = Math.random): number {
  const lower = 10_000;
  const ceiling = Math.min(300_000, lower * 2 ** Math.max(0, attempt - 1));
  return Math.floor(lower + Math.max(0, Math.min(1, random())) * (ceiling - lower));
}

async function deliver(deliveryId: string, allowRetry: boolean): Promise<void> {
  startDeliveryAttempt(deliveryId);
  const row = deliveryForSend(deliveryId);
  if (!row) return;
  const ts = now();
  if (row.message.expiresAt <= ts) {
    markDeliveryTerminal(deliveryId, 'expired', null, 'expired');
    return;
  }
  if (!enabled) {
    markDeliveryTerminal(deliveryId, 'permanent_failure', null, 'push-not-configured');
    return;
  }
  const subscription = subscriptionForDelivery(deliveryId);
  if (!subscription || !isAllowedPushEndpoint(subscription.endpoint)) {
    markDeliveryTerminal(deliveryId, 'permanent_failure', null, 'subscription-unreadable', true);
    return;
  }
  if (!row.message.title || !row.message.body) {
    markDeliveryTerminal(deliveryId, 'permanent_failure', null, 'payload-redacted');
    return;
  }

  const payload = declarativePayload(
    {
      title: row.message.title,
      body: row.message.body,
      url: row.message.url,
      tag: row.message.tag,
    },
    deliveryId,
    receiptTokenForDelivery(deliveryId),
    row.message.createdAt,
  );

  try {
    const response = await webpush.sendNotification(
      subscription as Parameters<typeof webpush.sendNotification>[0],
      JSON.stringify(payload),
      {
        TTL: Math.max(0, Math.ceil((row.message.expiresAt - ts) / 1000)),
        urgency: row.message.urgency as 'very-low' | 'low' | 'normal' | 'high',
        topic: row.message.topic,
        timeout: PROVIDER_TIMEOUT_MS,
      },
    );
    // Provider acceptance is terminal for application retries. Client receipts are
    // tracked separately and their absence is unknown, never a reason to duplicate.
    markDeliveryAccepted(deliveryId, response.statusCode ?? 201);
  } catch (error) {
    const action = classifyPushFailure(error, ts);
    const status = (error as { statusCode?: number }).statusCode ?? null;
    if (action.kind === 'invalidate') {
      markDeliveryTerminal(deliveryId, 'permanent_failure', status, action.code, true);
      return;
    }
    if (action.kind === 'permanent' || !allowRetry) {
      markDeliveryTerminal(deliveryId, 'permanent_failure', status, action.code);
      return;
    }

    const attempt = row.delivery.attempts;
    const delay = action.retryAfterMs ?? retryDelayMs(attempt);
    const next = ts + delay;
    const retryAge = next - row.message.createdAt;
    if (attempt >= MAX_ATTEMPTS || retryAge > MAX_RETRY_AGE_MS || next >= row.message.expiresAt) {
      markDeliveryTerminal(
        deliveryId,
        next >= row.message.expiresAt ? 'expired' : 'permanent_failure',
        status,
        attempt >= MAX_ATTEMPTS ? 'retry-attempt-limit' : 'retry-age-limit',
      );
      return;
    }
    rescheduleDelivery(deliveryId, next, status, action.code);
  }
}

async function withConcurrency(ids: string[], allowRetry: boolean): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++]!;
      await deliver(id, allowRetry).catch((error) => {
        console.warn(`notification delivery ${id} failed internally: ${(error as Error).message}`);
      });
    }
  });
  await Promise.all(workers);
}

/** Shadow's scoped direct path: one provider attempt, never an application retry. */
export function dispatchShadow(messageId: string): void {
  void withConcurrency(deliveriesForShadow(messageId), false);
}

let started = false;
let running = false;
let maintenanceAt = 0;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    dbTransaction(() => expireQueuedDeliveries());
    if (now() - maintenanceAt > 60 * 60 * 1000) {
      dbTransaction(() => pruneNotificationData());
      maintenanceAt = now();
    }
    const ids = dbTransaction(() => claimDeliveries(CLAIM_SIZE));
    if (ids.length > 0) await withConcurrency(ids, true);
  } catch (error) {
    console.warn(`notification worker tick failed: ${(error as Error).message}`);
  } finally {
    running = false;
  }
}

/** Start once, on the first real server request; the timer does not keep Node alive. */
export function ensureNotificationWorker(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => void tick(), WORKER_INTERVAL_MS);
  timer.unref?.();
  void tick();
}
