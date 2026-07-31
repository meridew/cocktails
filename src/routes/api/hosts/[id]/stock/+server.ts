import { json, type RequestEvent } from '@sveltejs/kit';
import { host, OPTIONAL_CATEGORIES, STOCKABLE, makeable, suggestions } from '$lib/shared';
import { listStock, setInStock, userById } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/** How many ingredients one host may track. Generous; a guard against a flood. */
const MAX_ITEMS = 400;

/** What this cupboard can pour, trimmed to what a list needs. Both verbs answer it. */
const pourable = (stock: readonly string[]) =>
  makeable(stock, { ignore: OPTIONAL_CATEGORIES }).map((r) => ({
    id: r.id,
    name: r.name,
    base: r.base,
  }));

/**
 * A **host's** cupboard — `/api/hosts/[id]/stock`, not `/api/inventory`.
 *
 * The path is the point. This used to hang off a bar session, which meant the only
 * way to say "I have gin" was to be standing behind a bar — so the screen for it got
 * built inside the bartender's screen, days away from when a host actually fills a
 * cupboard in. The subject of the question is a person, so the URL says so and the
 * guard is scoped to them.
 *
 * Its owner may read and write it; Admin may read and write anybody's, which is how
 * Dan fills one in for a host who hasn't got round to it. Nobody else sees it at all
 * — a 404 rather than a 403, so an id can't be used to discover who exists.
 */
export async function GET(event: RequestEvent) {
  const userId = event.params.id!;
  const auth = await requireCapability(event, 'stock:read', host(userId));
  if (denied(auth)) return auth.denied;
  if (!userById(userId)) return fail(404, 'no such host');

  const rows = listStock(userId);
  const stock = rows.filter((r) => r.inStock).map((r) => r.ingredient);

  return json({
    ok: true,
    /** Everything tickable, so the screen needs no second source. */
    stockable: STOCKABLE,
    stock,
    /** Whether anything has ever been recorded. Absence is not "no" — see schema.ts. */
    recorded: rows.length > 0,
    makeable: pourable(stock),
    /** What one more bottle would unlock — the question a tick list can't answer. */
    suggestions: suggestions(stock, { ignore: OPTIONAL_CATEGORIES }).slice(0, 10),
  });
}

/**
 * Replace the cupboard.
 *
 * A whole-list PUT rather than per-ingredient toggles: this is a set of checkboxes
 * somebody works through, and one request per tick would make the pourable count
 * flicker through states nobody chose.
 *
 * Anything unrecognised is dropped rather than rejected — a stale client sending an
 * ingredient we've since renamed should lose that one tick, not its whole list.
 */
export async function PUT(event: RequestEvent) {
  const userId = event.params.id!;
  const auth = await requireCapability(event, 'stock:edit', host(userId));
  if (denied(auth)) return auth.denied;
  if (!userById(userId)) return fail(404, 'no such host');

  const b = await body(event);
  if (!Array.isArray(b.stock)) return fail(422, 'stock must be an array');
  if (b.stock.length > MAX_ITEMS) return fail(422, 'too many ingredients');

  const known = new Set(STOCKABLE);
  const wanted = new Set(b.stock.filter((i): i is string => typeof i === 'string' && known.has(i)));

  // Everything currently recorded, so unticking is a real change rather than an
  // absence — a row set false is how we remember "asked and answered: no", which is
  // what keeps an untouched cupboard distinguishable from a deliberately empty one.
  const seen = new Set(listStock(userId).map((r) => r.ingredient));
  for (const ingredient of new Set([...wanted, ...seen])) {
    setInStock(userId, ingredient, wanted.has(ingredient));
  }

  const stock = [...wanted];
  return json({ ok: true, stock, recorded: true, makeable: pourable(stock) });
}
