import { json, type RequestEvent } from '@sveltejs/kit';
import { STOCKABLE, makeable, suggestions } from '$lib/shared';
import { listInventory, setInStock } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/** How many ingredients one event may track. Generous; a guard against a flood. */
const MAX_ITEMS = 400;

/**
 * Tonight's stock, and what it can pour.
 *
 * The makeable list is computed here rather than shipped as raw stock plus a
 * client-side filter, so the bar and the guest menu cannot disagree about what's
 * available — the same reason the permission table lives in one place.
 */
export function GET(event: RequestEvent) {
  const auth = requireCapability(event, 'inventory:read');
  if (denied(auth)) return auth.denied;

  const rows = listInventory(auth.staff.eventId);
  const stock = rows.filter((r) => r.inStock).map((r) => r.ingredient);

  return json({
    ok: true,
    /** Everything a host could tick, so the screen needs no second source. */
    stockable: STOCKABLE,
    stock,
    makeable: makeable(stock).map((r) => ({ id: r.id, name: r.name, base: r.base })),
    /** What one more bottle would unlock — the question a tick list can't answer. */
    suggestions: suggestions(stock).slice(0, 10),
  });
}

/**
 * Replace the stock list.
 *
 * A whole-list PUT rather than per-ingredient toggles: the host's screen is a set of
 * checkboxes they work through, and sending one request per tick would make the
 * makeable list flicker through states nobody chose.
 *
 * Anything not recognised is dropped rather than rejected — a stale client sending
 * an ingredient we've since renamed should lose that one tick, not its whole list.
 */
export async function PUT(event: RequestEvent) {
  const auth = requireCapability(event, 'inventory:edit');
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  if (!Array.isArray(b.stock)) return fail(422, 'stock must be an array');
  if (b.stock.length > MAX_ITEMS) return fail(422, 'too many ingredients');

  const known = new Set(STOCKABLE);
  const wanted = new Set(b.stock.filter((i): i is string => typeof i === 'string' && known.has(i)));

  // Everything currently recorded, so unticking is a real change rather than an
  // absence — a row set false is how we remember "asked and answered: no".
  const seen = new Set(listInventory(auth.staff.eventId).map((r) => r.ingredient));
  for (const ingredient of new Set([...wanted, ...seen])) {
    setInStock(auth.staff.eventId, ingredient, wanted.has(ingredient));
  }

  const stock = [...wanted];
  return json({
    ok: true,
    stock,
    makeable: makeable(stock).map((r) => ({ id: r.id, name: r.name, base: r.base })),
  });
}
