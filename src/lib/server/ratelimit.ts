/**
 * Fixed-window rate limiting, keyed by client IP.
 *
 * One implementation for every caller: the login brute-force brake and the public
 * write endpoints. In-memory on purpose — a single API instance on a NAS doesn't
 * need a shared store, and a restart clearing the counters is acceptable for a
 * party app. (If this ever runs multi-instance, swap the Map for a shared store
 * behind this same interface.)
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { now } from './db';
import { clientIp } from './http';

export interface RateLimiterOptions {
  /** Countable events allowed per window before the key is limited. */
  max: number;
  windowMs: number;
  /** Safety valve so a flood of distinct keys can't grow the map without bound. */
  maxKeys?: number;
}

export interface RateLimiter {
  /** Is this key currently over its limit? */
  isLimited(key: string): boolean;
  /** Record one countable event against the key. */
  record(key: string): void;
  /** Forget a key (e.g. after a successful login). */
  clear(key: string): void;
}

export function createRateLimiter({
  max,
  windowMs,
  maxKeys = 5000,
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, { n: number; resetAt: number }>();

  /**
   * Drop expired entries; if that isn't enough, evict the entries closest to
   * expiring. Pruning only the expired ones would be a no-op under a flood of
   * fresh keys, which is exactly when the bound matters.
   */
  function enforceBound(): void {
    if (hits.size <= maxKeys) return;
    const t = now();
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
    if (hits.size <= maxKeys) return;
    const byExpiry = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of byExpiry.slice(0, hits.size - maxKeys)) hits.delete(key);
  }

  return {
    isLimited(key) {
      const entry = hits.get(key);
      return !!entry && entry.resetAt > now() && entry.n >= max;
    },

    record(key) {
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now()) hits.set(key, { n: 1, resetAt: now() + windowMs });
      else entry.n += 1;
      enforceBound();
    },

    clear(key) {
      hits.delete(key);
    },
  };
}

/**
 * Throttle for the unauthenticated write endpoints.
 *
 * Without it, a loop against POST /api/orders both spams the bar with pushes and —
 * once the order cap is reached — evicts the party's real queue.
 *
 * Returns the 429 to send back, or null to continue. That shape means the guard
 * reads the same way as the auth ones at the top of a handler, instead of being a
 * middleware registration several files away from what it protects.
 */
const writeLimiter = createRateLimiter({ max: 30, windowMs: 60 * 1000 });

export function rateLimitWrites(event: RequestEvent): Response | null {
  const ip = clientIp(event);
  if (writeLimiter.isLimited(ip)) {
    return json({ ok: false, error: 'slow down — too many requests' }, { status: 429 });
  }
  writeLimiter.record(ip);
  return null;
}
