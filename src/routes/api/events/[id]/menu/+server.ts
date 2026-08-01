import { json, type RequestEvent } from '@sveltejs/kit';
import { isSoundCue, party, readSettings, RECIPES, type PartySounds } from '$lib/shared';
import { eventById, listSounds, setEventMenu } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { generatedMenu } from '$lib/server/menu';

/** Recipe ids one party may feature. Generous; a guard against a flood. */
const MAX_SHORT_LIST = 60;

/**
 * What this party can pour — **generated from the host's cupboard**, and public,
 * because guests are anonymous.
 *
 * A menu is not a secret: it's the thing on the kitchen table under the QR code.
 * Requiring a session would mean signing in to read a drinks list, which is the
 * opposite of the point.
 *
 * ## Generated, not filtered
 *
 * This used to answer "which of Dan's six curated drinks can we pour", which meant a
 * host with a well-stocked bar still saw six drinks. It now answers "what can this
 * cupboard make", from the full catalogue. That is the promise §1 has been making since
 * its first paragraph.
 *
 * ## Where the list comes from when there is no cupboard
 *
 * A host who has never opened the stock screen has not told us they have nothing —
 * so we cannot generate, and generating from an empty cupboard would produce an
 * empty menu at exactly the moment someone is deciding whether to trust the app.
 * They get the **house list**: the six curated drinks, which is what the app served
 * before any of this and is a working party on its own.
 *
 * The distinction survives because the cupboard PUT writes `false` rows rather than
 * deleting them: untick everything and `recorded` is still true, so a deliberately
 * bare cupboard produces a bare menu and an untouched one does not.
 */
export function GET(event: RequestEvent) {
  const found = eventById(event.params.id!);
  if (!found) return fail(404, 'no such party');

  // The cupboard belongs to the host, and this same result gates POST /api/orders.
  const { source, recorded, stock, items, shortList } = generatedMenu(found);

  return json({
    ok: true,
    /**
     * `status` ships with the menu so the guest screen can say the bar is shut
     * **before** somebody builds a round. Only a live party takes orders, and
     * refusing at send time alone would mean choosing three drinks, typing a name and
     * then being told none of it counted.
     */
    event: { id: found.id, name: found.name, status: found.status },
    /** Where the list came from, so the guest screen can say so honestly. */
    source,
    recorded,
    items,
    /**
     * Recipe ids this party leads with. **Empty means show everything** — curation is
     * optional and its absence must not read as a broken menu.
     */
    shortList,
    /**
     * Which extras the menu offers — see `PUT ./settings`, which has no GET of its
     * own precisely so that this is the one payload carrying them. It is already
     * public, already what the guest screen reads, and already re-read every minute,
     * so a host flipping a switch reaches open menus for free.
     */
    settings: readSettings(found.settings),
    /**
     * Which takes are live, per cue — ids only, never the audio.
     *
     * A cue is on exactly when it has an enabled take, so there is no separate switch
     * that could disagree with the recordings underneath it. The guest's phone fetches
     * each clip once from its own immutable URL and picks between them at play time,
     * which is what makes "record it four times and let the party choose" cost one
     * small array on a payload that re-polls every minute.
     */
    sounds: listSounds(found.id).reduce(
      (acc, s) => {
        if (s.enabled && isSoundCue(s.cue)) acc[s.cue].push(s.id);
        return acc;
      },
      { join: [], add: [], sent: [] } as PartySounds,
    ),
    /**
     * The cupboard itself, so "help me choose" can run in the browser.
     *
     * Shipping this is not the duplication the old comment here warned about. That
     * was about two *different* computations of what's pourable drifting apart; the
     * client walks the same `$lib/shared` engine over the same ingredients, and
     * `items` above stays the authority for what's on the menu. Without it the walk
     * would need a round trip per question, which is not a walk.
     */
    stock,
  });
}

/**
 * Choose what this party leads with.
 *
 * **An empty list is a real answer** — it means "don't feature anything", which
 * lands the guest on the full generated list. That is also the default, so curating
 * is genuinely optional rather than a step everyone has to do.
 *
 * Ids that aren't on the menu are dropped rather than rejected: a host who curates,
 * then takes the gin out of their cupboard, should lose that one entry and not have
 * their whole list refused.
 */
export async function PUT(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'menu:curate', party(eventId));
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  if (!Array.isArray(b.recipes)) return fail(422, 'recipes must be an array');
  if (b.recipes.length > MAX_SHORT_LIST) return fail(422, 'too many drinks');

  const known = new Set(RECIPES.map((r) => r.id));
  const wanted = [
    ...new Set(b.recipes.filter((id): id is string => typeof id === 'string' && known.has(id))),
  ];

  setEventMenu(eventId, wanted);
  return json({ ok: true, shortList: wanted });
}
