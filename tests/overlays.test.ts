/**
 * Every modal overlay uses the shared `dialog` action.
 *
 * **This exists because one didn't.** `src/lib/dialog.ts` focuses the overlay on
 * open, traps Tab inside it, closes on Escape, marks the background `inert`, and
 * returns focus to whatever opened it. Seven overlays used it. `WorkSheet.svelte`
 * shipped with a hand-rolled `svelte:window` Escape listener and none of the other
 * four behaviours — not because the primitive was missing or inadequate, but
 * because a new component was written without reaching for it.
 *
 * That is the failure mode this file is aimed at, and it is the one a component
 * library is usually bought to solve. The library is not the fix here: the action
 * is good, well documented and already shared. What was missing was anything that
 * noticed a new overlay had skipped it. Now something does.
 *
 * Deliberately a source-text check rather than a rendered one. Focus traps and
 * `inert` are exactly the things jsdom models badly, so a runtime assertion here
 * would be reassuring and hollow — see `styles.test.ts` for the same reasoning
 * applied to CSS.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = join(process.cwd(), 'src', 'lib', 'components');

/**
 * A component is a modal overlay if it says so in ARIA.
 *
 * Keyed on `aria-modal="true"` rather than on a list of filenames, so a new
 * overlay is covered the day it is written — a hand-maintained list would have to
 * be updated by the same person who forgot the action.
 */
function overlays(): { name: string; source: string }[] {
  return readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.svelte'))
    .map((name) => ({ name, source: readFileSync(join(COMPONENTS, name), 'utf8') }))
    .filter((c) => /aria-modal=["']?true/.test(c.source));
}

describe('modal overlays', () => {
  test('this test has subjects', () => {
    // If the app stops declaring `aria-modal` anywhere, the check below passes
    // vacuously and should be reconsidered rather than left looking green.
    assert.ok(overlays().length >= 5, 'expected several modal overlays to exist');
  });

  test('every one of them uses the shared dialog action', () => {
    const missing = overlays()
      .filter((c) => !/use:dialog/.test(c.source))
      .map((c) => c.name);

    assert.deepEqual(
      missing,
      [],
      `${missing.join(', ')} declares aria-modal but does not use:dialog — so it has no ` +
        'focus trap, leaves the background reachable behind it, and does not restore ' +
        'focus on close. Add `use:dialog={{ onclose }}` and a `tabindex="-1"`.',
    );
  });

  test('and none of them re-implements Escape on the window', () => {
    // The tell that somebody rebuilt a piece of the action by hand: the action
    // already handles Escape on the node, so a window-level listener means either a
    // duplicate or a component that skipped the action and papered over one of the
    // five behaviours it provides.
    const rolled = overlays()
      .filter((c) => /svelte:window[^>]*onkeydown/.test(c.source))
      .map((c) => c.name);

    assert.deepEqual(rolled, [], `${rolled.join(', ')} handles keys itself; dialog.ts does that`);
  });
});
