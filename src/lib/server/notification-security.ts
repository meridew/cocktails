import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { PushSubscriptionJSON } from '$lib/shared';
import { config } from './config';

const key = createHash('sha256')
  .update('cocktails:push-subscription:v1\0')
  .update(config.vapid.dataKey)
  .digest();

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function endpointHash(endpoint: string): string {
  return sha256(`endpoint\0${endpoint}`);
}

export function hashCapability(token: string): string {
  return sha256(`capability\0${token}`);
}

export function newCapability(): string {
  return randomBytes(32).toString('base64url');
}

/** Restart-stable receipt capability; only its one-way hash is stored in SQLite. */
export function receiptCapability(deliveryId: string): string {
  return createHmac('sha256', key).update(`receipt\0${deliveryId}`).digest('base64url');
}

export function capabilityMatches(token: string, expectedHash: string): boolean {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashCapability(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** `iv.authTag.ciphertext`, each component base64url encoded. */
export function sealSubscription(subscription: PushSubscriptionJSON): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(subscription), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function openSubscription(ciphertext: string): PushSubscriptionJSON | null {
  try {
    const parts = ciphertext.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0]!, 'base64url');
    const tag = Buffer.from(parts[1]!, 'base64url');
    const body = Buffer.from(parts[2]!, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || body.length === 0) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(
      Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const sub = parsed as PushSubscriptionJSON;
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys.auth) return null;
    return sub;
  } catch {
    return null;
  }
}

/** Opaque URL-safe Web Push Topic, comfortably below the 32-byte limit. */
export function notificationTopic(scope: string): string {
  return createHash('sha256').update(`topic\0${scope}`).digest('base64url').slice(0, 32);
}
