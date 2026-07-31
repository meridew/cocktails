/**
 * The letters, and the one thing about them that can silently stop being true.
 *
 * `email.render.ts` hard-codes hex values because CSS custom properties do not
 * survive an inbox. That is unavoidable and it is also a copy — so the moment
 * somebody restyles `neo.css`, the emails keep sending last year's palette and
 * nothing anywhere complains. This is what complains.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTE, render } from '$lib/server/email.render';

const neo = readFileSync(new URL('../src/lib/neo.css', import.meta.url), 'utf8');

/** The value `neo.css` gives a custom property in `:root`. */
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(neo);
  assert.ok(m, `neo.css has no --${name}`);
  return m[1]!.trim();
}

describe('the emails wear the same palette as the app', () => {
  test('every colour still matches neo.css', () => {
    // If one of these fails, neo.css moved and the emails did not. Change the
    // constant, don't change the assertion.
    assert.equal(PALETTE.bg, token('bg'));
    assert.equal(PALETTE.ink, token('text'));
    assert.equal(PALETTE.accent, token('accent'));
    assert.equal(PALETTE.cyan, token('card1'));
    assert.equal(PALETTE.lime, token('card2'));
  });
});

describe('a letter renders both halves', () => {
  const letter = {
    subject: 'Confirm your email for cocktails',
    heading: "You're nearly in",
    lines: ['Confirm this address to finish setting up your account.'],
    cta: { label: 'Confirm my email', url: 'https://cock.meridew.com/verify?t=abc123' },
    outro: ['Nothing has changed yet.'],
  };

  test('the plain half carries the link on a line of its own', () => {
    const { text } = render(letter);
    // A client that linkifies plain text needs the URL unwrapped and unadorned;
    // wrapping it in punctuation is how half a link ends up clickable.
    assert.ok(text.split('\n').includes(letter.cta.url));
    assert.match(text, /Confirm this address/);
    assert.match(text, /Nothing has changed yet/);
  });

  test('the HTML half says everything the plain half says', () => {
    const { html, text } = render(letter);
    for (const line of [...letter.lines, ...letter.outro]) {
      assert.ok(html.includes(line), `HTML is missing "${line}"`);
      assert.ok(text.includes(line), `text is missing "${line}"`);
    }
    // Three times on purpose: the button's href, and the fallback link's href *and*
    // its visible text — so it survives a client that strips the button, and a reader
    // who would rather see where a link goes before following it.
    assert.equal(html.split(letter.cta.url).length - 1, 3);
  });

  test('it survives the clients that make email hard', () => {
    const { html } = render(letter);
    // Outlook renders with Word: no flex, no grid.
    assert.ok(!/display:\s*(flex|grid)/.test(html), 'Word cannot lay that out');
    // Gmail drops <style> blocks, so nothing that matters may live in one.
    assert.ok(!html.includes('<style'), 'anything in a <style> block is a coin flip');
    // Custom properties do not survive either — that is the whole reason PALETTE exists.
    assert.ok(!html.includes('var(--'), 'a custom property in an inbox is a missing colour');
    assert.match(html, /role="presentation"/, 'layout tables must not be read as data');
  });

  test('nothing interpolated can break out into markup', () => {
    const { html } = render({
      subject: 'x',
      heading: '<script>alert(1)</script>',
      lines: ['Tom & Jerry\'s "bar"'],
      cta: { label: 'Go', url: 'https://example.com/?a=1&b=2' },
    });
    assert.ok(!html.includes('<script>'), 'a heading became markup');
    assert.ok(html.includes('&amp;'), 'an ampersand went through raw');
    // A URL is the likeliest place for this to matter: it is the one field that
    // routinely contains & and is written by something other than us.
    assert.ok(html.includes('https://example.com/?a=1&amp;b=2'));
  });
});
