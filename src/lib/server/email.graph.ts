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
 * The app registration this needs is the one human step (`PLATFORM-PLAN.md` §9.1),
 * and `Mail.Send` is **tenant-wide by default** — a leaked secret could send as
 * anybody in the tenant. The Application Access Policy scoping it to one mailbox is
 * not optional; §8.2, and don't skip it.
 */
import { X509Certificate, createPrivateKey, createSign, randomUUID } from 'node:crypto';
import type { Email, EmailSender } from './email';

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  /**
   * PEM holding **both** the private key and its certificate.
   *
   * A certificate rather than a client secret, for three reasons. Only the
   * *public* half is ever uploaded to Entra, so no secret passes through a
   * clipboard or a chat window. Client secrets are hard-capped at 24 months and
   * `PLATFORM-PLAN.md` §10 lists that expiry as an accepted risk with nothing to
   * remind us — a certificate's lifetime is ours to choose. And Microsoft
   * recommends certificates over secrets for app-only auth.
   */
  keyPem: string;
  /** The mailbox we send as — the one the access policy pins us to. */
  sender: string;
}

/** True when every piece is present. Missing any means fall back to logging. */
export const graphConfigured = (c: GraphConfig): boolean =>
  Boolean(c.tenantId && c.clientId && c.keyPem && c.sender);

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * A JWT proving we hold the private key behind the certificate Entra knows.
 *
 * This replaces `client_secret` in the token request. `x5t` is the base64url of
 * the certificate's **SHA-1 fingerprint bytes** — not the hex string — and getting
 * that wrong produces AADSTS700027 ("the key was not found"), which reads like the
 * upload failed rather than like an encoding mistake.
 *
 * Entra requires RS256.
 */
export function clientAssertion(config: GraphConfig, now = Date.now()): string {
  const cert = new X509Certificate(config.keyPem);
  const thumbprint = Buffer.from(cert.fingerprint.replace(/:/g, ''), 'hex');

  const header = { alg: 'RS256', typ: 'JWT', x5t: b64url(thumbprint) };
  const seconds = Math.floor(now / 1000);
  const payload = {
    aud: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    iss: config.clientId,
    sub: config.clientId,
    // Unique per assertion: Entra rejects a replayed jti, which is the point.
    jti: randomUUID(),
    // A minute of leeway backwards for clock skew; five minutes forward is ample
    // for one token request and keeps a stolen assertion nearly worthless.
    nbf: seconds - 60,
    exp: seconds + 300,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(createPrivateKey(config.keyPem));

  return `${signingInput}.${b64url(signature)}`;
}

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
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: clientAssertion(config),
        }),
      },
    );

    if (!res.ok) {
      // Deliberately not including the body: it can echo the client_id, and this
      // string ends up in logs. The status is enough to tell 401 (the certificate
      // isn't the one registered) from 400 (wrong tenant).
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
