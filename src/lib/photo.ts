/**
 * A guest's face: taken on their phone, shrunk before it ever leaves it.
 *
 * **The resizing is the whole point of doing this on the client.** A modern phone
 * camera hands back three to eight *megabytes*; the bar needs a 32px circle in a
 * queue. Sending the original and shrinking it server-side would mean uploading
 * a thousand times more than anybody looks at, over a kitchen's wifi, from a phone
 * somebody is holding while queueing for a drink.
 *
 * So: crop to a square, scale to 256, encode as WebP. That lands at three to eight
 * kilobytes — small enough to sit in a SQLite row and small enough that the upload
 * is not something a guest waits for.
 *
 * **The photo lives on the device, not on one party.** Somebody who takes a selfie
 * at Owain's should not be asked again at Sam's, so it is kept here and offered to
 * whichever party this device joins. `event_guest` gets a copy because that is what
 * the bar reads and what deletes with the party.
 */
import { storage } from './storage';

const KEY = 'photo';
const ID_KEY = 'photo_id';

/**
 * How big a stored avatar is.
 *
 * 256 rather than the 32-96 the bar actually draws: a retina phone renders that
 * circle at up to 3x, and a face is the one thing where softness reads as "broken
 * camera" rather than "small image". It is still only a few kilobytes.
 */
const SIZE = 256;

/** Good enough for a face at 32px. Higher is wasted on a circle this small. */
const QUALITY = 0.8;

/**
 * A short, stable name for a picture's *content*.
 *
 * It is the URL the bar fetches by, which is what lets that URL be cached forever —
 * the queue re-polls every four seconds and must not re-download the same faces. And
 * it lets a returning device ask "do you already have this one?" without uploading.
 *
 * SHA-256 truncated to 32 hex characters: not a secret, but not guessable either,
 * and far past collision range for a party's worth of guests.
 */
export async function photoId(dataUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(dataUrl);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Turn whatever the camera gave us into a small square WebP data URL.
 *
 * **Centre-cropped, not squashed.** A phone photo is 4:3 or 3:4; scaling that into a
 * square without cropping makes every face either wide or long, which is a strange
 * thing to do to a picture of a person.
 *
 * WebP with a JPEG fallback: `toDataURL` quietly returns a PNG when it doesn't know
 * the type asked for, and a PNG of a photograph is ten times the size — so the result
 * is checked rather than assumed.
 */
export async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Couldn't read that picture");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

    const webp = canvas.toDataURL('image/webp', QUALITY);
    if (webp.startsWith('data:image/webp')) return webp;
    return canvas.toDataURL('image/jpeg', QUALITY);
  } finally {
    bitmap.close();
  }
}

/** The photo this device carries from party to party, or null. */
export const savedPhoto = (): string | null => storage.read(KEY);

/** Its content hash, so a join can be asked about it without sending it. */
export const savedPhotoId = (): string | null => storage.read(ID_KEY);

/** Keep a picture for next time — and for every other party this device visits. */
export async function savePhoto(dataUrl: string): Promise<string> {
  const id = await photoId(dataUrl);
  storage.write(KEY, dataUrl);
  storage.write(ID_KEY, id);
  return id;
}

/** Take it back. The copies already sent to parties are cleared separately. */
export function forgetPhoto(): void {
  storage.remove(KEY);
  storage.remove(ID_KEY);
}

/**
 * Which picture this device has already given to a given party.
 *
 * **The device remembers, not the server.** Joining runs on every menu load, so
 * something has to stop the picture going up every single time. The obvious place
 * was the join response — "have you got this one?" — and that was written and then
 * taken out again: `POST /api/events/<id>/guests` answers exactly `{ ok: true }` and
 * `tests/guests.test.ts` holds it there, because the value of that response is that
 * it is *empty*. A rule with one harmless exception is a rule somebody argues with
 * next time.
 *
 * Keeping the bookkeeping here costs one storage key per party this device has
 * actually visited, and it is only ever a cache: getting it wrong re-sends a few
 * kilobytes, which is the cheapest possible way to be wrong.
 */
const sentKey = (eventId: string) => `photo_at_${eventId}`;

export const photoSentTo = (eventId: string): string | null => storage.read(sentKey(eventId));

export function rememberPhotoSent(eventId: string, id: string | null): void {
  if (id) storage.write(sentKey(eventId), id);
  else storage.remove(sentKey(eventId));
}

/**
 * Initials for the fallback — at most two, from the first and last words.
 *
 * "Mary-Jane van der Berg" gives MV rather than MJVDB: two letters is what fits in a
 * circle, and the first and last are what people actually use.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * A colour for a name, picked from the name.
 *
 * Deterministic, exactly like the glasses on the front door: the same person keeps
 * the same colour between visits and between screens, and one that changed on reload
 * would read as a glitch. Twelve hues, spaced far enough apart that two people in the
 * same queue are unlikely to be confusable.
 */
export function hueFor(name: string): number {
  const n = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return (n % 12) * 30;
}
