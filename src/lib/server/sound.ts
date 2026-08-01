/**
 * What counts as a storable recording.
 *
 * This lives here rather than beside the endpoint that validates uploads because the
 * endpoint that *serves* them needs the same answer, and a `+server.ts` may only
 * export HTTP methods — SvelteKit refuses the module at runtime otherwise, which
 * neither the typecheck nor the unit tests catch, since both import the file
 * directly and never go through the router.
 */

/**
 * The container types browsers actually produce, and nothing else.
 *
 * The stored string's own prefix becomes the `Content-Type` when it is served back,
 * so this list is what stops that being anything a caller fancies.
 */
const ALLOWED = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'];

/** Where the base64 starts in a data URL, and how much of it to skip. */
export const MARKER = ';base64,';

/**
 * `data:audio/webm;codecs=opus;base64,…` → `audio/webm`, or null if it isn't one.
 *
 * Compares only the part before the first `;`, because Chrome writes
 * `audio/webm;codecs=opus` and Safari writes plain `audio/mp4`.
 */
export function baseType(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:')) return null;
  const at = dataUrl.indexOf(MARKER);
  if (at < 0) return null;
  const mime = dataUrl.slice(5, at).split(';')[0]!.toLowerCase();
  return ALLOWED.includes(mime) ? mime : null;
}
