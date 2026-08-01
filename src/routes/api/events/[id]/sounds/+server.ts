import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, isSoundCue, party, MAX_TAKES_PER_CUE } from '$lib/shared';
import { addSound, countSounds, eventById, listSounds } from '$lib/server/db';
import { baseType } from '$lib/server/sound';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/**
 * How big one take may be, base64 and all.
 *
 * The recorder caps at five seconds and asks for Opus where the browser has it,
 * which lands around 10–20KB; Safari's AAC is fatter. 256KB is generous enough that
 * a browser encoding badly still works, and small enough that fifteen of them —
 * the most a party can hold — is under four megabytes on disk and far less on the
 * wire, since a guest only ever fetches the enabled ones.
 */
const MAX_TAKE = 256 * 1024;

/**
 * Every take at this party, for the host's list. **Never the audio.**
 *
 * Rendering three rows should not cost three clips; the host previews one by asking
 * for it, from the same immutable URL the guests use.
 */
export async function GET(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'menu:curate', party(eventId));
  if (denied(auth)) return auth.denied;

  return json({ ok: true, sounds: listSounds(eventId) });
}

/**
 * Keep a take.
 *
 * A row per recording rather than a slot per cue, which is what makes "record it four
 * times and let the party pick" work at all. New takes arrive enabled: the host just
 * made it on purpose, and landing switched-off would read as the save having failed.
 */
export async function POST(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'menu:curate', party(eventId));
  if (denied(auth)) return auth.denied;

  if (!eventById(eventId)) return fail(404, 'no such party');

  const b = await body(event);
  if (!isSoundCue(b.cue)) return fail(422, 'not a cue we play');

  const audio = typeof b.audio === 'string' ? b.audio : '';
  if (!audio) return fail(422, 'audio required');
  if (audio.length > MAX_TAKE) return fail(413, 'that recording is too long');
  if (!baseType(audio)) return fail(422, 'not a sound we can store');

  // Bounded per cue, not per party: the ceiling exists because every enabled take is
  // fetched by every guest's phone, and that budget is spent one cue at a time.
  const already = countSounds(eventId, b.cue);
  if (already >= MAX_TAKES_PER_CUE) {
    return fail(409, `that cue already has ${MAX_TAKES_PER_CUE} takes`);
  }

  const label = cleanStr(b.label, 40) || `Take ${already + 1}`;
  return json({ ok: true, ...addSound({ eventId, cue: b.cue, audio, label }) });
}
