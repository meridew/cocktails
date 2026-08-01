import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, party } from '$lib/shared';
import { eventById, photoByHash, setGuestPhoto } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * How big a stored selfie may be, base64 and all.
 *
 * The client crops to 256px and encodes as WebP, which lands at three to eight
 * kilobytes; 64KB is generous enough that an odd device encoding badly still works,
 * and small enough that nobody can use this as free storage. A photograph straight
 * off a camera is a hundred times this and is refused.
 */
const MAX_PHOTO = 64 * 1024;

/** Only what the client actually produces, so this can never become a file drop. */
const ALLOWED = ['data:image/webp;base64,', 'data:image/jpeg;base64,'];

/**
 * A guest attaches their face. **Public, like joining, and for the same reason.**
 *
 * A guest has no account and no token — the whole design of the guest role is that
 * they need neither. What they have is a device id, which is the same soft handle
 * `joinParty` uses: not an identity, a speed bump. The real control is unchanged and
 * is downstream of here — a human reads every name and looks at every face before
 * pouring anything, and an un-admitted guest's order sits behind a `✓`.
 *
 * So the risk this takes is that somebody who has the party's link can set a picture
 * against a device id they invented. That is the same risk as them inventing a name,
 * which the app has always accepted.
 */
export async function PUT(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const eventId = event.params.id!;
  if (!eventById(eventId)) return fail(404, 'no such party');

  const b = await body(event);
  const deviceId = cleanStr(b.deviceId, 80);
  if (!deviceId) return fail(422, 'deviceId required');

  /** Null clears it — "actually, don't" has to be as easy as saying yes. */
  if (b.photo === null) {
    setGuestPhoto(eventId, deviceId, null, null);
    return json({ ok: true });
  }

  const photo = typeof b.photo === 'string' ? b.photo : '';
  const photoId = cleanStr(b.photoId, 64);
  if (!photo || !photoId) return fail(422, 'photo and photoId required');
  if (photo.length > MAX_PHOTO) return fail(413, 'that picture is too big');
  if (!ALLOWED.some((p) => photo.startsWith(p))) return fail(422, 'not a picture we can store');

  setGuestPhoto(eventId, deviceId, photo, photoId);
  return json({ ok: true });
}

/**
 * The bar looks at a face.
 *
 * **Guarded, and fetched rather than `<img src>`'d.** A bar session is a bearer
 * token, which an image tag cannot send — so the alternative to this was an
 * unguessable public URL. These are photographs of somebody's friends, so the guard
 * stays and `Avatar.svelte` fetches the bytes properly.
 *
 * Keyed by content hash, which is what makes `immutable` honest: this URL can only
 * ever return one picture, so a queue that re-polls every four seconds fetches each
 * face exactly once.
 */
export async function GET(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'orders:read', party(eventId));
  if (denied(auth)) return auth.denied;

  const wanted = event.url.searchParams.get('id') ?? '';
  const found = wanted ? photoByHash(eventId, wanted) : null;
  if (!found) return fail(404, 'no such photo');

  return json({ ok: true, photo: found });
}
