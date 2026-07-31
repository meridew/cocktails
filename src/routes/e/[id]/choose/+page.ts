import { rememberEvent } from '$lib/party';

/**
 * The walk, at its own address — same party, same loader.
 *
 * It used to remember the party and bounce to `/`. Two things made that wrong. `/`
 * is the front door now (sign in, or register), which is not what somebody who
 * scanned a code off a kitchen table is looking for. And a guest who bookmarked or
 * shared the menu ended up with a URL naming no party — fine while there was only
 * ever one, useless now that several run at once.
 *
 * So the party lives in the path, which is the same shape everything else moved to:
 * the request says which party it means rather than the server guessing.
 *
 * Still remembers the id in device storage, because the basket and the order it
 * eventually posts are device-local and outlive this page.
 */
export function load({ params }: { params: { id: string } }): { eventId: string } {
  rememberEvent(params.id);
  return { eventId: params.id };
}
