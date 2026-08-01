/**
 * Whether somebody is still in the middle of arriving at a party.
 *
 * **This exists to stop two asks landing at once.** `NotifyOptIn` is mounted in the
 * root layout and its only condition was "we've never asked and the browser could
 * still prompt" — nothing about what else is on screen. So a guest opening a party
 * link for the first time met the inline "Who's this?" panel *and* a modal over the
 * top of it, which is two decisions before they have seen a single drink.
 *
 * That was already true before selfies; adding the photo to the arrival panel would
 * have made it two decisions and a camera. So the notification card now waits: the
 * menu raises this while it is asking, and drops it once there is a name.
 *
 * Deliberately not persisted. It describes this moment on this screen, and a stale
 * `true` in storage would silence the notification card forever.
 */
const state = $state({ arriving: false });

export const arrival = {
  /** True while the menu is asking who somebody is. */
  get arriving() {
    return state.arriving;
  },
};

export function setArriving(value: boolean): void {
  state.arriving = value;
}
