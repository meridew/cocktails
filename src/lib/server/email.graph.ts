/**
 * Microsoft Graph `sendMail`, app-only.
 *
 * Two HTTP calls and no npm package: fetch a client-credentials token, POST the
 * message. That is the entire reason Graph won over a transactional-email vendor —
 * the tenant already exists on `meridew.com` with SPF/DKIM/DMARC warm, so there is
 * no new vendor, no new DNS and no new dependency.
 *
 * **Not SMTP.** Exchange Online disables basic auth for SMTP AUTH by default from
 * the end of December 2026, so building on it would have had a five-month life.
 *
 * The app registration this needs is the one human step (`PLATFORM-PLAN.md` §8.1),
 * and `Mail.Send` is **tenant-wide by default** — a leaked secret could send as
 * anybody in the tenant. The Application Access Policy scoping it to one mailbox is
 * not optional; §8.2, and don't skip it.
 */
import type { Email, EmailSender } from './email';

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The mailbox we send as — the one the access policy pins us to. */
  sender: string;
}

/** True when every piece is present. Missing any means fall back to logging. */
export const graphConfigured = (c: GraphConfig): boolean =>
  Boolean(c.tenantId && c.clientId && c.clientSecret && c.sender);

interface CachedToken {
  value: string;
  /** epoch ms */
  expiresAt: number;
}

/**
 * A sender bound to one app registration.
 *
 * Built as a factory rather than a module singleton so a test can hand it a fake
 * config and a fake `fetch` without touching global state — and so a second sender
 * (a different mailbox, one day) costs nothing.
 */
export function graphSender(config: GraphConfig, fetchImpl: typeof fetch = fetch): EmailSender {
  let cached: CachedToken | null = null;

  async function token(): Promise<string> {
    // Tokens last about an hour. Re-fetching per message would triple the round
    // trips for no benefit; the 60s margin covers clock skew and a slow send.
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

    const res = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      },
    );

    if (!res.ok) {
      // Deliberately not including the body: it can echo the client_id, and this
      // string ends up in logs. The status is enough to tell 401 (wrong secret,
      // or expired — they last 24 months) from 400 (wrong tenant).
      throw new Error(`Graph token request failed (HTTP ${res.status})`);
    }

    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Graph token response had no access_token');

    cached = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return cached.value;
  }

  return {
    async send(email: Email): Promise<void> {
      const access = await token();
      const res = await fetchImpl(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject: email.subject,
              body: {
                contentType: email.html ? 'HTML' : 'Text',
                content: email.html ?? email.text,
              },
              toRecipients: [{ emailAddress: { address: email.to } }],
            },
            // Nobody reads bar@meridew.com's Sent Items, and every verification
            // mail landing there is just storage nobody asked for.
            saveToSentItems: false,
          }),
        },
      );

      // Graph answers a successful sendMail with 202 Accepted and no body.
      if (res.status !== 202 && !res.ok) {
        throw new Error(`Graph sendMail failed (HTTP ${res.status})`);
      }
    },
  };
}
