import { json, type RequestEvent } from '@sveltejs/kit';
import { availability, makeable, type Category } from '$lib/shared';
import { DRINKS } from '$lib/data';
import { eventById, listInventory } from '$lib/server/db';
import { fail } from '$lib/server/guards';

/**
 * Garnishes don't gate a drink.
 *
 * A missing olive shouldn't hide a Martini, and asking a host to tick fourteen
 * garnishes before their menu behaves would make the stock screen a chore rather
 * than a minute's work. Stated here rather than buried in `makeable` because it is
 * a product decision, not a property of the engine.
 */
const IGNORE: readonly Category[] = ['finish'];

/**
 * What this party can pour — public, because guests are anonymous.
 *
 * A menu is not a secret: it's the thing on the kitchen table under the QR code.
 * Requiring a session would mean signing in to read a drinks list, which is the
 * opposite of the point.
 *
 * Computed here rather than shipping raw stock for the client to filter, so the
 * guest menu and the bar cannot disagree about what's available — the same reason
 * the permission table lives in one place.
 */
export function GET(event: RequestEvent) {
  const party = eventById(event.params.id!);
  if (!party) return fail(404, 'no such party');

  const stock = listInventory(party.id)
    .filter((r) => r.inStock)
    .map((r) => r.ingredient);

  return json({
    ok: true,
    event: { id: party.id, name: party.name },
    /** name → can we pour it. Unknown drinks report available; see `availability`. */
    available: availability(
      stock,
      DRINKS.map((d) => d.name),
      { ignore: IGNORE },
    ),
    /** Everything the stock can make, for a host deciding what else to offer. */
    makeable: makeable(stock, { ignore: IGNORE }).map((r) => ({
      id: r.id,
      name: r.name,
      base: r.base,
    })),
  });
}
