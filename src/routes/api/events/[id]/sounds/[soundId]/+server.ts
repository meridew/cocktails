import { json, type RequestEvent } from '@sveltejs/kit';
import { party } from '$lib/shared';
import { deleteSound, setSoundEnabled } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/**
 * Switch one take on or off.
 *
 * **Off is not deleted**, and keeping the two apart is the point: a host who decides
 * a take is too loud for tonight should not have to choose between hearing it again
 * next time and never hearing it again. A cue is live when at least one of its takes
 * is on, so switching the last one off silences the cue without a second switch that
 * could disagree with it.
 */
export async function PATCH(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'menu:curate', party(eventId));
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  if (typeof b.enabled !== 'boolean') return fail(422, 'enabled must be true or false');

  // Scoped to the party inside the query, so a take id learned at one party cannot
  // be flipped at another.
  return setSoundEnabled(eventId, event.params.soundId!, b.enabled)
    ? json({ ok: true })
    : fail(404, 'no such recording');
}

/** Bin it for good. The cue falls silent on its own once nothing enabled is left. */
export async function DELETE(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'menu:curate', party(eventId));
  if (denied(auth)) return auth.denied;

  return deleteSound(eventId, event.params.soundId!)
    ? json({ ok: true })
    : fail(404, 'no such recording');
}
