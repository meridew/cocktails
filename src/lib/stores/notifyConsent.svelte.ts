/**
 * Whether we've already asked this device about notifications.
 *
 * Separate from `push.svelte.ts`, which tracks what the *browser and server* think.
 * This tracks what the **person** told us, which is a different fact with a
 * different lifetime: someone can decline our card while the browser permission
 * stays 'default', and we must respect that rather than re-asking on every visit.
 *
 * Kept deliberately small — one recorded answer — because the browser's own
 * permission is the real state and duplicating it here would only let the two drift.
 */
import { permissionState } from '$lib/stores/push.svelte';
import { storage } from '$lib/storage';

const KEY = 'notify_consent';

/** `accepted` — they said yes (whatever the browser then decided). */
export type OptInChoice = 'accepted' | 'declined';

const stored = storage.read(KEY);
const state = $state<{ choice: OptInChoice | null }>({
  choice: stored === 'accepted' || stored === 'declined' ? stored : null,
});

export const notifyConsent = {
  get choice() {
    return state.choice;
  },
  /**
   * Ask only when we've never had an answer *and* the browser could still show a
   * prompt. Once permission is granted or denied there is nothing left to ask:
   * granted is done, and denied can't be undone from script.
   */
  get shouldAsk() {
    return state.choice === null && permissionState() === 'default';
  },
};

export function recordChoice(choice: OptInChoice): void {
  state.choice = choice;
  storage.write(KEY, choice);
}

/**
 * Forget the answer, so the card can be offered again.
 * Used when someone turns notifications off and later wants them back.
 */
export function resetChoice(): void {
  state.choice = null;
  storage.remove(KEY);
}
