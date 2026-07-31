import { json, type RequestEvent } from '@sveltejs/kit';
import { availability, makeable, OPTIONAL_CATEGORIES } from '$lib/shared';
import { DRINKS } from '$lib/data';
import { eventById, listStock } from '$lib/server/db';
import { fail } from '$lib/server/guards';

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

  // The cupboard belongs to the **host**, not the party — so several parties for the
  // same host all read one list, and a host who restocks does it once.
  const rows = listStock(party.hostUserId);
  const stock = rows.filter((r) => r.inStock).map((r) => r.ingredient);

  /**
   * A host who has never opened the stock screen has not told us they have nothing.
   *
   * Without this, the default state of every brand-new party is a menu with four of
   * six drinks greyed out — the app looking broken at exactly the moment someone is
   * deciding whether to trust it. "Never asked" is not "asked and answered no", and
   * the PUT already keeps that distinction alive by writing `false` rows rather than
   * deleting them: untick everything and this is `false`, so the gating is real from
   * the first tick onward.
   */
  const unrecorded = rows.length === 0;

  return json({
    ok: true,
    event: { id: party.id, name: party.name },
    /** name → can we pour it. Unknown drinks report available; see `availability`. */
    available: unrecorded
      ? Object.fromEntries(DRINKS.map((d) => [d.name, true]))
      : availability(
          stock,
          DRINKS.map((d) => d.name),
          { ignore: OPTIONAL_CATEGORIES },
        ),
    /** Everything the stock can make, for a host deciding what else to offer. */
    makeable: makeable(stock, { ignore: OPTIONAL_CATEGORIES }).map((r) => ({
      id: r.id,
      name: r.name,
      base: r.base,
    })),
  });
}
