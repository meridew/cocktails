import { json } from '@sveltejs/kit';
import { liveEvents } from '$lib/server/db';

/**
 * What's on tonight. **Public, and the only party data an anonymous caller may read.**
 *
 * The front door used to be a sign-in form, which had it backwards: hosts and staff
 * are a handful of people and guests are everyone else. This is what the door shows
 * them instead.
 *
 * ## What this publishes, and what it doesn't
 *
 * A party id used to be twelve hex characters that travelled only in a QR code on a
 * kitchen table — not a secret, but not announced either. Listing them means anyone
 * who finds the domain learns that a party called "Rae's 40th" is happening. That is
 * a deliberate trade Dan made: the service is for friends, and "I've lost the QR
 * code" is a real problem it solves.
 *
 * So it is kept to the minimum that makes the list usable: **id and name**. Not the
 * host's name, not their email, not when it starts, not how many people are there.
 * A name somebody chose for their own party is theirs to publish; the rest isn't.
 *
 * ## Why `live` is the whole filter
 *
 * Opening a party already means it takes orders (§5a). Making it mean "and it is on
 * the front door" adds no second concept and nothing extra to remember on the night —
 * close it and it goes.
 */
export function GET() {
  return json({
    ok: true,
    parties: liveEvents().map((e) => ({ id: e.id, name: e.name })),
  });
}
