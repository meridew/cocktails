/**
 * Shared modal behaviour: focus the dialog on open, trap Tab inside it, close
 * on Escape, make the background `inert`, and restore focus to the trigger on
 * close. Used by every overlay so a11y is consistent and DRY.
 */
import type { Action } from 'svelte/action';

let depth = 0;
function appInert(on: boolean) {
  const app = document.getElementById('app');
  if (!app) return;
  if (on) app.setAttribute('inert', '');
  else app.removeAttribute('inert');
}

/** Refcounted background lock (so the menu behind a modal isn't tabbable/AT-reachable). */
export function lockBackground(): () => void {
  depth++;
  if (depth === 1) appInert(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth--;
    if (depth === 0) appInert(false);
  };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const dialog: Action<HTMLElement, { onclose?: () => void } | undefined> = (node, params) => {
  let opts = params ?? {};
  const prev = document.activeElement as HTMLElement | null;
  const release = lockBackground();

  const focusables = () =>
    Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);

  queueMicrotask(() => (focusables()[0] ?? node).focus());

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      opts.onclose?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (f.length === 0) {
      e.preventDefault();
      node.focus();
      return;
    }
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', onKey);

  return {
    update(next) {
      opts = next ?? {};
    },
    destroy() {
      node.removeEventListener('keydown', onKey);
      release();
      prev?.focus?.();
    },
  };
};
