/**
 * Shared modal behaviour: focus the dialog on open, trap Tab inside it, close
 * on Escape, make the *background* inert, and restore focus to the trigger on
 * close. Used by every overlay so a11y is consistent and DRY.
 *
 * Dialogs are direct children of #app (Svelte's mount target), so we inert the
 * dialog's *siblings* — never #app itself, which would also inert the dialog and
 * make it unclickable.
 */
import type { Action } from 'svelte/action';

/**
 * Inert every sibling of `keep` inside #app; returns an undo fn. Only touches
 * elements that aren't already inert, so stacked locks nest and unwind cleanly.
 */
export function lockBackground(keep?: HTMLElement): () => void {
  const app = document.getElementById('app');
  if (!app) return () => {};
  const locked = Array.from(app.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== keep && !el.hasAttribute('inert'),
  );
  for (const el of locked) el.setAttribute('inert', '');
  return () => {
    for (const el of locked) el.removeAttribute('inert');
  };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const dialog: Action<HTMLElement, { onclose?: () => void } | undefined> = (node, params) => {
  let opts = params ?? {};
  const prev = document.activeElement as HTMLElement | null;
  const release = lockBackground(node);

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
