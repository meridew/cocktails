/**
 * HTTP-layer helpers shared by the endpoints: reading credentials and identifying
 * the client. Kept out of the route files so the parsing rules are unit-testable
 * without constructing a request.
 */
import type { RequestEvent } from '@sveltejs/kit';

/** Extract a bearer token from the Authorization header. */
export function bearerToken(header: string | null | undefined): string | undefined {
  if (!header || !/^bearer /i.test(header)) return undefined;
  const token = header.slice(7).trim();
  return token || undefined;
}

/** Convenience: the bearer token on an incoming request. */
export const bearer = (event: RequestEvent): string | undefined =>
  bearerToken(event.request.headers.get('authorization'));

/**
 * First hop of an XFF chain. The header is a client-controlled comma list, so
 * only the leftmost entry is meaningful — and taking the whole string as a key
 * would let an attacker rotate it freely to defeat rate limiting.
 */
export function firstForwardedFor(header: string | null | undefined): string | undefined {
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
export function clientIp(event: RequestEvent): string {
  const cf = event.request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = firstForwardedFor(event.request.headers.get('x-forwarded-for'));
  if (forwarded) return forwarded;
  try {
    return event.getClientAddress() || 'unknown';
  } catch {
    return 'unknown'; // no socket behind the event (constructed in tests)
  }
}
