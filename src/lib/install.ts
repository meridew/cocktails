/**
 * Adding this to a Home Screen: who should be asked, and whether they already said no.
 *
 * **One place, because there used to be two and they disagreed.** `push.svelte.ts`
 * knew that iPadOS reports itself as a Mac and checked `maxTouchPoints`;
 * `InstallButton.svelte` matched the user agent for `iphone|ipad|ipod` and did not.
 * So on an iPad the notification card correctly said "that needs the app on your Home
 * Screen first" and rendered an install button that drew **nothing** — the one screen
 * telling somebody to install had no way to do it.
 */
import { storage } from './storage';
import { overrides } from './devOverrides';

/**
 * Who is being asked, because the answer is completely different per role.
 *
 * A **guest** is at one party for one evening; installing gains them very little, and
 * a permanent "Install app" chip in their menu — which is what this replaced — was
 * loud for the person who benefits least.
 *
 * A **bartender** works all night, and on iOS *cannot receive order alerts at all*
 * without installing. That is the person the prompt is for, and the bar screen used
 * to offer them nothing.
 */
export type InstallAudience = 'guest' | 'bar';

/** Running as an installed app rather than a browser tab. */
export function isInstalled(): boolean {
  const forced = overrides().installed;
  if (forced !== undefined) return forced;
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS predates the standard and still reports it here only.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * iPhone or iPad — including the iPads that lie about it.
 *
 * iPadOS 13 and later report a Macintosh user agent. The touch points give it away,
 * and getting this wrong is not cosmetic: iOS is the platform where installing is
 * *required* for notifications, so a missed detection silently removes the only route
 * to them.
 */
export function isApple(): boolean {
  const forced = overrides().platform;
  if (forced) return forced === 'ios';
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

/**
 * Inside a Capacitor WebView there is nothing to install — it *is* the app.
 *
 * Checked by scheme rather than by importing `@capacitor/core`, which would be a
 * dependency carried solely to hide one button, for a native project that does not
 * exist yet. Capacitor on iOS serves `https://localhost`; the dev server is *http* on
 * localhost, so the scheme is what keeps them apart.
 */
export function isNativeShell(): boolean {
  if (typeof location === 'undefined') return false;
  return (
    location.protocol === 'capacitor:' ||
    (location.protocol === 'https:' && location.hostname === 'localhost')
  );
}

/** Nothing to offer somebody who has already got it, or who cannot install at all. */
export const canInstall = (): boolean => !isInstalled() && !isNativeShell();

const KEY = (who: InstallAudience) => `install_dismissed_${who}`;

/**
 * Whether this person has already waved the prompt away.
 *
 * **Per audience, and that is the point.** Somebody who declined as a guest at a
 * birthday has said nothing about whether they want it when they end up behind a bar
 * three weeks later, where it is the only route to order alerts. One shared "no" would
 * silence the case that matters most.
 *
 * Nothing here ever re-asks by itself: a no is remembered until it is reset, and both
 * prompts are always reachable again from Settings.
 */
export const dismissed = (who: InstallAudience): boolean => storage.read(KEY(who)) === '1';

export const dismiss = (who: InstallAudience): void => storage.write(KEY(who), '1');

/** Used when somebody deliberately goes looking in Settings — start clean. */
export const undismiss = (who: InstallAudience): void => storage.remove(KEY(who));

/** Should we put the prompt in front of this person, unasked? */
export const shouldOffer = (who: InstallAudience): boolean => canInstall() && !dismissed(who);
