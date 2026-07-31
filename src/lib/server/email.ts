/**
 * Sending email, behind an interface.
 *
 * The production sender is Microsoft Graph `sendMail` against the existing M365
 * tenant on `meridew.com` — no new vendor, no new DNS, and no new npm package
 * because it is a `fetch` POST. It needs an Entra app registration that only a
 * human at a browser can create (`docs/PLATFORM-PLAN.md` §9.1), so it is not
 * wired yet.
 *
 * Rather than let that block accounts, this is an interface with a development
 * implementation that writes the message to the log. Verification links are then
 * readable in the dev server output, the whole sign-up flow is testable end to
 * end, and swapping in Graph later is one new object and one line in `pick()`.
 *
 * **Not SMTP.** Exchange Online disables basic auth for SMTP AUTH by default from
 * the end of December 2026, with removal announced for H2 2027 — building on it
 * would have had a five-month shelf life.
 */
import { readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { config } from './config';
import { graphConfigured, graphSender } from './email.graph';

export interface Email {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional and mail clients fall back to this. */
  text: string;
  html?: string;
}

export interface EmailSender {
  send(email: Email): Promise<void>;
}

/**
 * Writes the message to the log instead of sending it.
 *
 * Deliberately prints the whole body: the point is that a verification link is
 * usable from the terminal during development, which is what makes the sign-up
 * flow testable without a mailbox.
 */
export const loggingSender: EmailSender = {
  async send(email: Email): Promise<void> {
    console.info(
      [
        '',
        '📧 ─────────────────────────────',
        `to:      ${email.to}`,
        `subject: ${email.subject}`,
        '',
        email.text,
        '───────────────────────────────',
        '',
      ].join('\n'),
    );
  },
};

/**
 * Appends each message to a file as JSON, one per line.
 *
 * For the end-to-end suite, which drives a **real server in another process** and so
 * cannot reach `memorySender` below. Verification is not something the browser can
 * skip — an unverified account is refused everywhere — so "register through the front
 * door" is only walkable if the link is readable from outside the server.
 *
 * Appends rather than rewrites, and tolerates a missing directory only by failing
 * loudly: a silently swallowed write here would show up as a test that hangs waiting
 * for mail that was never recorded.
 */
export function fileSender(path: string): EmailSender {
  return {
    async send(email: Email): Promise<void> {
      await appendFile(path, `${JSON.stringify(email)}\n`, 'utf8');
    },
  };
}

/**
 * Collects messages instead of sending them, so a test can assert on what would
 * have gone out — particularly the verification link, which it then follows.
 */
export function memorySender(): EmailSender & { sent: Email[] } {
  const sent: Email[] = [];
  return {
    sent,
    async send(email: Email): Promise<void> {
      sent.push(email);
    },
  };
}

/**
 * Graph when the tenant is configured, the log otherwise.
 *
 * Chosen once, lazily, so importing this module reads no config and opens no
 * connection. A missing credential is not an error: it degrades to "the
 * verification link is in the server log", which is a working development loop
 * rather than a sign-up that fails with nothing to show for it.
 */
function pick(): EmailSender {
  // `EMAIL_OUTBOX` outranks everything, because setting it is an explicit
  // instruction rather than a partial configuration. It exists for the end-to-end
  // suite, which runs the real server in another process and has to read the
  // verification link back out. Production never sets it; if it somehow did, the
  // line below is the only warning anyone would get, so it says so plainly.
  if (config.emailOutbox) {
    console.warn(`📧 email: writing to ${config.emailOutbox} — NOTHING IS BEING SENT`);
    return fileSender(config.emailOutbox);
  }

  const { tenantId, clientId, keyFile, sender } = config.graph;

  // Read here rather than in config.ts so importing config never touches the
  // filesystem, and so a missing or unreadable key degrades to the log rather
  // than throwing at import time — where it would take the whole server down
  // for a feature nothing had used yet.
  let keyPem = '';
  if (keyFile) {
    try {
      keyPem = readFileSync(keyFile, 'utf8');
    } catch {
      console.warn(`📧 email: cannot read GRAPH_KEY_FILE (${keyFile}) — falling back to the log`);
    }
  }

  const graph = { tenantId, clientId, keyPem, sender };
  if (!graphConfigured(graph)) {
    console.info('📧 email: Graph not configured — messages go to the log (see OUTSTANDING.md)');
    return loggingSender;
  }
  console.info(`📧 email: sending via Microsoft Graph as ${sender}`);
  return graphSender(graph);
}

let sender: EmailSender | null = null;

/** Swap the sender. Tests use this. */
export function setEmailSender(next: EmailSender): void {
  sender = next;
}

export const sendEmail = (email: Email): Promise<void> => (sender ??= pick()).send(email);
