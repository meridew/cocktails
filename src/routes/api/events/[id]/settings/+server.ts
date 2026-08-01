import { json, type RequestEvent } from '@sveltejs/kit';
import { party, readSettings, writeSettings, type PartySettings } from '$lib/shared';
import { eventById, updateEvent } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/**
 * Which extras this party's menu offers.
 *
 * ## Why this isn't on `PATCH /api/events/[id]`
 *
 * That endpoint is `party:edit` — rename it, date it, open and shut the bar — and an
 * admin holds it. This is `menu:curate`, which a **host holds at their own party**,
 * the same capability that chooses which drinks the bar will make. Turning off "See
 * it in 3D" is taste about your own evening, not administration of it, and it sits
 * next to the short list on both screens for exactly that reason.
 *
 * ## There is no GET
 *
 * The settings ride out on `GET /api/events/[id]/menu`, because that is the payload
 * the guest already reads and already re-reads every sixty seconds. A second
 * endpoint would mean a second poll to learn the same thing, and a window where the
 * menu and its extras disagree.
 */
export async function PUT(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'menu:curate', party(eventId));
  if (denied(auth)) return auth.denied;

  const found = eventById(eventId);
  if (!found) return fail(404, 'no such party');

  const b = await body(event);
  if (!b.settings || typeof b.settings !== 'object') return fail(422, 'settings must be an object');

  /**
   * A partial body is a real request. The host flipped one switch; making them send
   * all three back would mean a second tab that flipped a *different* one has its
   * answer silently undone. So: what's stored, with the incoming keys laid over it.
   *
   * `readSettings` then does the filtering — it keeps only keys we know and only
   * boolean values, so an unrecognised field can't be stored and a `"maybe"` can't
   * become truthy.
   */
  const merged: PartySettings = readSettings({ ...readSettings(found.settings), ...b.settings });

  updateEvent(eventId, { settings: writeSettings(merged) });
  return json({ ok: true, settings: merged });
}
