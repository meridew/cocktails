// @vitest-environment jsdom
/**
 * The notification opt-in modal.
 *
 * This is the file that justifies the Vitest setup. Every question here used to be
 * answered by driving a real browser one round-trip at a time — and the most
 * important ones *couldn't* be, because that browser has notifications permanently
 * denied, so the modal could never appear in it. Here the permission is a value we
 * set, and a "next visit" is a re-render.
 *
 * The property under test throughout: the browser's permission prompt is one-shot
 * and a denial is permanent, so it must only ever be reached from a deliberate tap.
 */
import { test, describe, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import NotifyOptIn from '$lib/components/NotifyOptIn.svelte';
import { recordChoice, resetChoice } from '$lib/stores/notifyConsent.svelte';

/** Pretend the browser is in a given notification state. */
function setPermission(value: NotificationPermission) {
  const Fake = function () {} as unknown as typeof Notification;
  Object.defineProperty(Fake, 'permission', { get: () => value, configurable: true });
  vi.stubGlobal('Notification', Fake);
}

/**
 * jsdom has neither, and the component must not offer what the browser can't do.
 *
 * The unsupported case genuinely *deletes* the globals rather than setting them to
 * undefined: `pushSupported()` tests `'PushManager' in window`, which stays true for
 * a property that merely holds undefined.
 */
function setPushSupported(supported: boolean) {
  if (supported) {
    vi.stubGlobal('PushManager', function () {});
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
    return;
  }
  Reflect.deleteProperty(globalThis, 'PushManager');
  Reflect.deleteProperty(navigator, 'serviceWorker');
}

/**
 * Render the modal fresh.
 *
 * Calling it twice is what "and then they came back later" means: the consent store
 * is a module singleton that already holds the recorded answer, and a new component
 * instance re-evaluates whether to ask. No module-registry games needed — which is
 * just as well, since resetting it hands the component a second copy of Svelte's
 * runtime and nothing mounts.
 */
function mount() {
  cleanup();
  return render(NotifyOptIn);
}

const asked = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="optin-title"]');

const button = (label: RegExp): HTMLElement => {
  const match = [...document.querySelectorAll('button')].find((b) =>
    label.test(b.textContent ?? ''),
  );
  assert.ok(match, `expected a button matching ${label}`);
  return match;
};

const stored = () => localStorage.getItem('cocktail_notify_consent');

beforeEach(() => {
  setPushSupported(true);
  setPermission('default');
  resetChoice(); // a device that has never been asked
});

describe('when it asks', () => {
  test('a first visit with nothing decided gets the modal', async () => {
    mount();
    assert.ok(asked(), 'this is the one-time ask');
  });

  test('showing it stores nothing — the answer is the user’s to give', async () => {
    mount();
    assert.equal(stored(), null);
  });

  test('an already-granted browser is never asked again', async () => {
    setPermission('granted');
    mount();
    assert.equal(asked(), null, 'there is nothing left to ask');
  });

  test('an already-denied browser is never asked, because it cannot be undone', async () => {
    // The state the real test browser is permanently in — and precisely why this
    // case was impossible to check by hand.
    setPermission('denied');
    mount();
    assert.equal(asked(), null);
  });

  test('a browser with no push support is not offered something it cannot do', async () => {
    setPushSupported(false);
    mount();
    assert.equal(asked(), null);
  });
});

describe('answering it', () => {
  test('"Not now" records the answer and closes', async () => {
    mount();
    await userEvent.click(button(/not now/i));
    assert.equal(stored(), 'declined');
    assert.equal(asked(), null);
  });

  test('a declined answer means it never returns on the next visit', async () => {
    mount();
    await userEvent.click(button(/not now/i));
    mount(); // they come back later
    assert.equal(asked(), null, 'asking again would be nagging');
  });

  test('Escape counts as an answer, so it cannot nag either', async () => {
    mount();
    await userEvent.keyboard('{Escape}');
    assert.equal(stored(), 'declined');
    assert.equal(asked(), null);
  });

  test('"Yes" records acceptance before the browser decides anything', async () => {
    // Order matters: if we awaited the prompt first and the page were closed
    // mid-prompt, we'd have spent the permission and remembered nothing.
    mount();
    await userEvent.click(button(/yes, notify me/i));
    assert.equal(stored(), 'accepted');
  });

  test('accepting also stops it returning', async () => {
    mount();
    await userEvent.click(button(/yes, notify me/i));
    mount();
    assert.equal(asked(), null);
  });

  test('a declined device can be offered again once the choice is reset', async () => {
    // This is what the Settings switch relies on to give people a way back.
    recordChoice('declined');
    mount();
    assert.equal(asked(), null);
    resetChoice();
    mount();
    assert.ok(asked(), 'Settings must be able to re-offer it');
  });
});

describe('what it says', () => {
  test('promises only what it delivers, and points at Settings', async () => {
    mount();
    const text = asked()?.textContent ?? '';
    /**
     * **This test was pinning a lie, which is worth recording.**
     *
     * It asserted `/your own order/` — and the copy did say "Only about your own
     * order". But this card is mounted in the root layout, so it can be read on the
     * bar, where `pushToRole('bartender', …)` sends a push for *everybody's* drinks.
     * The promise also broke retroactively: accepting as a guest and later working a
     * bar triggers `enableIfPermitted('bartender')`.
     *
     * So the test's own name was right and its assertion was wrong. It now checks
     * that both audiences are named — which is what "only what it delivers" means
     * when two different people can read the same card.
     */
    assert.match(text, /your drink/i);
    assert.match(text, /behind the bar/i);
    // Reversible, which is what makes "Not now" a safe thing to tap.
    assert.match(text, /Settings/i);
  });

  test('is a modal, so it is unmissable', async () => {
    mount();
    assert.equal(asked()?.getAttribute('aria-modal'), 'true');
  });

  test('offers exactly two ways out, and neither is a dead end', async () => {
    mount();
    const labels = [...(asked()?.querySelectorAll('button') ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    assert.equal(labels.length, 2);
    assert.ok(labels.some((l) => /yes/i.test(l ?? '')));
    assert.ok(labels.some((l) => /not now/i.test(l ?? '')));
  });
});
