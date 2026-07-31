import { json, type RequestEvent } from '@sveltejs/kit';
import { whoami } from '$lib/server/guards';

/**
 * Who is calling — the one endpoint that asks no permission question.
 *
 * A reload keeps the credential but not what it means, and the client needs to know
 * whether to draw an admin's screen, a host's, or a bartender's. It returns the
 * **actor**, not a staff row, because that is now the thing the client reasons
 * about: `can()` on the client reads exactly this shape, so the two sides cannot
 * disagree about what someone is.
 *
 * Never 401s. "Nobody" is a valid, useful answer to "who am I" — the signed-out
 * front door asks this too, and an error would make it look broken.
 */
export async function GET(event: RequestEvent) {
  return json({ ok: true, actor: await whoami(event) });
}
