/**
 * Letters that look like the app, without pretending an inbox is a browser.
 *
 * The two account emails were plain text. That is not *wrong* — text is the one
 * format every client renders correctly — but it meant the first thing a new host
 * ever saw from this service looked nothing like the thing they had just signed up
 * to, which is exactly the moment a verification email gets mistaken for spam.
 *
 * ## Both halves, from one structure
 *
 * `render()` takes a `Letter` and returns the text and the HTML together. Neither is
 * written by hand, so they cannot drift — and they do drift, given the chance:
 * somebody edits the pretty one and the plain one keeps promising last month's
 * wording to exactly the clients least able to cope with a surprise.
 *
 * ## Why this looks nothing like `neo.css`
 *
 * Email is not the web, and the differences are not stylistic preferences:
 *
 * - **Tables, not flex or grid.** Outlook on Windows renders with Word's engine.
 * - **Inline styles.** Gmail drops `<style>` blocks in several common configurations,
 *   so anything that matters is on the element.
 * - **No custom fonts.** `Archivo Black` and `Bungee` will not load, so the display
 *   face falls back to the heaviest thing reliably installed. It reads chunky, which
 *   is the half of the design that survives the trip.
 * - **`box-shadow` is decoration, not structure.** The hard 6px offset is the app's
 *   signature and Outlook ignores it. The 4px border carries the look on its own, so
 *   the shadow is a bonus where it lands rather than something the layout needs.
 *
 * Colours are the real ones from `neo.css`, hard-coded because custom properties do
 * not survive either. If the palette there ever changes, this will silently stop
 * matching — hence `tests/email.test.ts`, which pins them together.
 */

/** Straight from `neo.css`'s `:root`. Kept in step by `tests/email.test.ts`. */
export const PALETTE = {
  bg: '#ffe600',
  surface: '#ffffff',
  ink: '#0a0a12',
  accent: '#ff2e88',
  cyan: '#00e5ff',
  lime: '#acff00',
} as const;

/** Heaviest reliably-installed stack, standing in for Archivo Black. */
const DISPLAY = "'Arial Black','Arial Bold',Gadget,Impact,'Helvetica Neue',Helvetica,sans-serif";
const BODY = "'Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif";

export interface Letter {
  subject: string;
  /** The one line at the top, in the display face. */
  heading: string;
  /** Paragraphs before the button. */
  lines: string[];
  /** The thing to go and do. Its URL is always repeated as text underneath. */
  cta?: { label: string; url: string };
  /** Paragraphs after it — usually "if this wasn't you". */
  outro?: string[];
}

/** Everything interpolated into HTML goes through this. No exceptions. */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function render(letter: Letter): { subject: string; text: string; html: string } {
  return { subject: letter.subject, text: asText(letter), html: asHtml(letter) };
}

/**
 * The plain half.
 *
 * **Graph does not send it.** `sendMail`'s `message.body` carries one content type,
 * so when HTML is present that is what goes, and Exchange down-converts for clients
 * that need text. Sending both would mean building a MIME multipart/alternative and
 * posting that instead — worth doing if the conversion ever reads badly, and not
 * before.
 *
 * It is not dead either way: the development sender logs it, the end-to-end suite
 * reads verification links out of it, and it is what any future transport sends. So
 * it says everything the HTML says, with the link on its own line where it stays
 * clickable.
 */
function asText(letter: Letter): string {
  const parts = [letter.heading.toUpperCase(), '', ...letter.lines];
  if (letter.cta) parts.push('', `${letter.cta.label}:`, letter.cta.url);
  if (letter.outro?.length) parts.push('', ...letter.outro);
  parts.push('', '—', "COCKTAILS!!! · Dan's bar");
  return parts.join('\n');
}

function asHtml(letter: Letter): string {
  const paragraph = (s: string) =>
    `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:1.55;color:${PALETTE.ink};">${esc(s)}</p>`;

  /**
   * A "bulletproof" button: the padding is on the anchor rather than the cell, so a
   * client that strips the table still leaves something finger-sized and clickable
   * rather than four underlined words.
   */
  const button = letter.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
        <tr><td bgcolor="${PALETTE.bg}" style="border:4px solid ${PALETTE.ink};border-radius:14px;">
          <a href="${esc(letter.cta.url)}" style="display:inline-block;padding:14px 26px;font-family:${DISPLAY};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${PALETTE.ink};text-decoration:none;">${esc(letter.cta.label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 14px;font-family:${BODY};font-size:13px;line-height:1.5;color:rgba(10,10,18,0.65);">
        Button not working? Copy this into your browser:<br>
        <a href="${esc(letter.cta.url)}" style="color:${PALETTE.ink};word-break:break-all;">${esc(letter.cta.url)}</a>
      </p>`
    : '';

  // Shown in the inbox list next to the subject. The spacer stops the client
  // grabbing the first line of real copy and repeating it.
  const preheader = letter.lines[0] ?? letter.heading;

  return `<div style="background-color:${PALETTE.bg};margin:0;padding:0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALETTE.bg}" style="background-color:${PALETTE.bg};">
    <tr><td align="center" style="padding:28px 14px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <tr><td style="padding-bottom:18px;font-family:${DISPLAY};font-size:30px;letter-spacing:-0.5px;color:${PALETTE.ink};">
          COCKTAILS<span style="color:${PALETTE.accent};">!!!</span>
        </td></tr>

        <tr><td bgcolor="${PALETTE.surface}" style="background-color:${PALETTE.surface};border:4px solid ${PALETTE.ink};border-radius:16px;box-shadow:6px 6px 0 ${PALETTE.ink};padding:26px 24px;">
          <h1 style="margin:0 0 16px;font-family:${DISPLAY};font-size:22px;line-height:1.15;letter-spacing:-0.5px;text-transform:uppercase;color:${PALETTE.ink};">${esc(letter.heading)}</h1>
          ${letter.lines.map(paragraph).join('\n          ')}
          ${button}
          ${(letter.outro ?? []).map(paragraph).join('\n          ')}
        </td></tr>

        <tr><td style="padding-top:18px;font-family:${BODY};font-size:12px;line-height:1.5;color:rgba(10,10,18,0.65);">
          Sent by <strong style="color:${PALETTE.ink};">COCKTAILS!!!</strong> — Dan's bar.
        </td></tr>

      </table>
    </td></tr>
  </table>
</div>`;
}
