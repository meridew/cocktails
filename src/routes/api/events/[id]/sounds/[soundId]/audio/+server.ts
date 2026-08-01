import { type RequestEvent } from '@sveltejs/kit';
import { soundAudio } from '$lib/server/db';
import { fail } from '$lib/server/guards';
import { baseType, MARKER } from '$lib/server/sound';

/**
 * One clip, as bytes. **Public, because the audience is guests.**
 *
 * A guest has no account and no token by design, and this is a noise the host chose
 * to play at everyone who walks in — it is the audio equivalent of the menu, which is
 * public for the same reason. Knowing the party link is the whole of the admission
 * test, exactly as it is for the drinks list.
 *
 * ## Bytes, not a data URL
 *
 * The selfie endpoint answers with JSON carrying a data URL, because a bar session is
 * a bearer token and an `<img src>` cannot send one. Nothing here needs a credential,
 * so `new Audio(url)` can fetch it directly — which skips base64's third-again of
 * overhead, lets the browser stream and buffer it, and means the HTTP cache holds it
 * rather than a Map we would have to write.
 *
 * ## Why `immutable` is honest here
 *
 * A take is never edited. Recording again makes another row with another id, so this
 * URL can only ever return one clip, forever. That is what lets a guest's phone fetch
 * each sound exactly once for the whole evening no matter how often the menu re-polls.
 */
export function GET(event: RequestEvent) {
  const stored = soundAudio(event.params.id!, event.params.soundId!);
  if (!stored) return fail(404, 'no such recording');

  // Stored as a data URL and validated against the allow-list on the way in, so this
  // can only ever be one of a handful of audio types — never a Content-Type of the
  // caller's choosing.
  const mime = baseType(stored);
  const at = stored.indexOf(MARKER);
  if (!mime || at < 0) return fail(500, 'that recording is unreadable');

  const bytes = Buffer.from(stored.slice(at + MARKER.length), 'base64');
  return new Response(bytes, {
    headers: {
      'content-type': mime,
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
