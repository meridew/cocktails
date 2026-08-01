/**
 * The noises a party makes, on the guest's phone.
 *
 * A host records takes; this picks one and plays it. Everything awkward about that
 * lives here so the three call sites are one line each.
 *
 * ## Autoplay is the whole design constraint
 *
 * Browsers refuse to play audio that no user gesture asked for, and on iOS the
 * refusal is total until the page has played *something* inside a real tap. So every
 * cue this module knows about is hung on a tap — `join` on "I'm in", `add` on adding
 * a drink, `sent` on sending the round — and there is deliberately no "on page load"
 * cue for anyone to reach for later. See `SOUND_CUES` for why the arrival one is
 * named after the tap rather than after arriving.
 *
 * `.play()` still returns a promise that can reject — a phone on silent, a device
 * policy we didn't predict — and every rejection is swallowed. A party sound failing
 * is not an error worth showing anybody mid-round.
 *
 * ## Why `<audio>` elements and not a fetch cache
 *
 * The clips come from a URL that can only ever return one thing (`sounds/<id>/audio`,
 * `immutable`), so the browser's own HTTP cache is exactly the cache we want and we
 * do not have to write it. Creating the elements at menu load lets them buffer during
 * the minutes before anyone taps, which is what makes the sound land *with* the tap
 * rather than a beat after it.
 */
import { takeAudioUrl } from '$lib/api';
import { NO_SOUNDS, type PartySounds, type SoundCue } from '$lib/shared';

/** Buffered clips, by take id. Module-level: one party per page, one set of sounds. */
const players = new Map<string, HTMLAudioElement>();

/** Which takes are live per cue, refreshed by every `load` — see the menu poll. */
let live: PartySounds = NO_SOUNDS;

const MUTE_KEY = 'party_sounds_off';

/**
 * Whether this device wants the party's sounds. **On unless somebody said no.**
 *
 * The host chose these deliberately, so defaulting to silence would mean the feature
 * did nothing for almost everyone. But a phone that starts making noises in a pocket
 * is its own problem, which is why the switch exists in Settings at all.
 */
export function soundsMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false; // private mode, or storage disabled — behave like the default
  }
}

export function muteSounds(off: boolean): void {
  try {
    if (off) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* nothing to remember it with; the session still honours the call below */
  }
  if (off) for (const el of players.values()) el.pause();
}

/**
 * Adopt the party's current takes, and start buffering anything new.
 *
 * Called on every menu load, so a host who records a sound mid-party reaches phones
 * already open on the menu within the poll. Elements are kept for ids we already
 * have — re-creating them would throw away the buffering that is the point — and
 * dropped for ids that have gone, so a deleted take stops occupying memory.
 */
export function loadSounds(eventId: string, sounds: PartySounds): void {
  live = sounds;
  const wanted = new Set(Object.values(sounds).flat());

  for (const id of wanted) {
    if (players.has(id)) continue;
    const el = new Audio(takeAudioUrl(eventId, id));
    el.preload = 'auto';
    players.set(id, el);
  }
  for (const id of [...players.keys()]) {
    if (!wanted.has(id)) players.delete(id);
  }
}

/**
 * Play one of this cue's takes, chosen at random.
 *
 * Silent and harmless when the cue has nothing, when the guest has muted, or when the
 * clip has not finished buffering — a sound that arrives late is worse than one that
 * doesn't arrive, because it lands on whatever the guest did next.
 *
 * Rewinds rather than overlapping: tapping "add" three times quickly should sound
 * like three taps, not like three voices talking over each other.
 *
 * **Must be called from inside a user gesture.** Every cue is, by design.
 */
export function playCue(cue: SoundCue): void {
  if (soundsMuted()) return;
  const takes = live[cue];
  if (!takes?.length) return;

  const el = players.get(takes[Math.floor(Math.random() * takes.length)]!);
  if (!el) return;

  try {
    el.currentTime = 0;
  } catch {
    /* not seekable yet — play from wherever it is rather than not at all */
  }
  void el.play().catch(() => {
    /* silenced device, autoplay policy, a codec this browser won't take — never
       worth interrupting somebody's round over */
  });
}

/** For tests and for leaving a party: forget the clips and the choices. */
export function forgetSounds(): void {
  for (const el of players.values()) el.pause();
  players.clear();
  live = NO_SOUNDS;
}
