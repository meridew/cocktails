/**
 * HTTP-layer helpers shared by the routes: reading credentials and identifying
 * the client. Kept out of app.ts so the parsing rules are unit-testable.
 */
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/** Extract a bearer token from the Authorization header. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header || !/^bearer /i.test(header)) return undefined;
  const token = header.slice(7).trim();
  return token || undefined;
}

/**
 * First hop of an XFF chain. The header is a client-controlled comma list, so
 * only the leftmost entry is meaningful — and taking the whole string as a key
 * would let an attacker rotate it freely to defeat rate limiting.
 */
export function firstForwardedFor(header: string | undefined): string | undefined {
  const first = header?.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Best available client identity for rate limiting.
 *
 * Cloudflare's `cf-connecting-ip` is set by the tunnel and can't be spoofed by a
 * client, so it wins. `x-forwarded-for` is only a fallback (and only its first
 * hop) because the LAN port is reachable without going through Cloudflare. The
 * socket address is the last resort — it is never client-controlled.
 */
export function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = firstForwardedFor(c.req.header('x-forwarded-for'));
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // non-node adapter (e.g. app.request in tests)
  }
}
