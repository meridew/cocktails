/**
 * Dev-only overrides for platform capabilities that are otherwise impossible to
 * drive from a desktop browser.
 *
 * The problem this solves: notification permission is a *one-shot, irreversible*
 * browser state. Once a profile has denied it, the opt-in modal can never render
 * there again — so the flow that matters most became untestable in the very
 * browser used to test it, and checking "what does an iPhone that hasn't installed
 * the app see?" meant finding an iPhone.
 *
 *   ?permission=default|granted|denied   what Notification.permission reports
 *   ?platform=ios|android|desktop        what the UA sniffing concludes
 *   ?installed=1|0                       standalone app vs browser tab
 *   ?push=unsupported|supported          whether the Push API exists at all
 *
 * Sticky in sessionStorage, so a reload keeps the pretend state and the URL stays
 * clean. `?reset-overrides` clears them.
 *
 * **These are inert in a production build.** Every read is behind
 * `import.meta.env.DEV`, which Vite replaces with a literal `false` when building
 * — so the branches below are dead code the bundler drops, and a `?permission=`
 * on the live site does nothing. `devOverrides.test.ts` asserts exactly that,
 * because a shipped override would be a genuine security bug rather than a bit of
 * stray dev convenience.
 */

const KEY = 'cocktail_dev_overrides';

export interface DevOverrides {
  permission?: NotificationPermission;
  platform?: 'ios' | 'android' | 'desktop';
  installed?: boolean;
  push?: 'supported' | 'unsupported';
}

const PERMISSIONS = ['default', 'granted', 'denied'];
const PLATFORMS = ['ios', 'android', 'desktop'];

/** Parse a query string into overrides, ignoring anything unrecognised. */
export function parseOverrides(search: string): DevOverrides {
  const p = new URLSearchParams(search);
  const out: DevOverrides = {};
  const permission = p.get('permission');
  if (permission && PERMISSIONS.includes(permission)) {
    out.permission = permission as NotificationPermission;
  }
  const platform = p.get('platform');
  if (platform && PLATFORMS.includes(platform)) out.platform = platform as DevOverrides['platform'];
  const installed = p.get('installed');
  if (installed === '0' || installed === '1') out.installed = installed === '1';
  const push = p.get('push');
  if (push === 'supported' || push === 'unsupported') out.push = push;
  return out;
}

let cache: DevOverrides | null = null;

/**
 * The overrides in force. Always `{}` outside dev — the whole body is behind the
 * DEV check so the bundler can drop it.
 */
export function overrides(): DevOverrides {
  if (!import.meta.env.DEV) return {};
  if (cache) return cache;
  if (typeof window === 'undefined') return {};

  if (new URLSearchParams(location.search).has('reset-overrides')) {
    sessionStorage.removeItem(KEY);
    cache = {};
    return cache;
  }

  const fromUrl = parseOverrides(location.search);
  if (Object.keys(fromUrl).length > 0) {
    sessionStorage.setItem(KEY, JSON.stringify(fromUrl));
    cache = fromUrl;
  } else {
    try {
      cache = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as DevOverrides;
    } catch {
      cache = {};
    }
  }
  if (Object.keys(cache).length > 0) {
    console.info('[dev] capability overrides in force:', cache);
  }
  return cache;
}

/** Forget them, for a test that needs a clean read. */
export function clearOverridesCache(): void {
  cache = null;
}
