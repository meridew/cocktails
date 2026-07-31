import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, party } from '$lib/shared';
import { deleteEvent, eventById, updateEvent } from '$lib/server/db';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/** Valid party states. `draft` → `live` → `done`, moved by hand and never inferred. */
const STATUSES = ['draft', 'live', 'done'] as const;
type Status = (typeof STATUSES)[number];
const isStatus = (v: unknown): v is Status => STATUSES.includes(v as Status);

/**
 * One party. Readable by anyone who may see its queue — which is Admin, its host,
 * and the staff working it.
 */
export async function GET(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'orders:read', party(eventId));
  if (denied(auth)) return auth.denied;
  const found = eventById(eventId);
  return found ? json({ ok: true, event: found }) : fail(404, 'no such party');
}

/**
 * Rename it, date it, open it, close it.
 *
 * **Opening and closing are their own capabilities**, separate from editing, because
 * they are the two that change what guests can do. Splitting them costs nothing now
 * and means a future "host may end their own party" is a one-line table change
 * rather than a re-think.
 *
 * Nothing here opens a party on a schedule. A date is a label; a mistyped one would
 * otherwise lock a room full of people out of the menu at nine on a Saturday.
 */
export async function PATCH(event: RequestEvent) {
  const eventId = event.params.id!;
  const b = await body(event);

  const wants = isStatus(b.status) ? b.status : null;
  if ('status' in b && !wants) return fail(422, `status must be one of ${STATUSES.join(', ')}`);

  // The capability depends on which direction you are moving it.
  const capability =
    wants === 'live' ? 'party:open' : wants === null ? 'party:edit' : 'party:close';
  const auth = await requireCapability(event, capability, party(eventId));
  if (denied(auth)) return auth.denied;

  const changes: { name?: string; startsAt?: number | null; status?: string } = {};
  if ('name' in b) {
    const name = cleanStr(b.name, 80);
    if (!name) return fail(422, 'a party needs a name');
    changes.name = name;
  }
  if ('startsAt' in b) changes.startsAt = typeof b.startsAt === 'number' ? b.startsAt : null;
  if (wants) changes.status = wants;

  const updated = updateEvent(eventId, changes);
  return updated ? json({ ok: true, event: updated }) : fail(404, 'no such party');
}

/**
 * Delete it, and everything hung off it.
 *
 * Cascades to the orders and the short list. It does **not** touch the cupboard —
 * that belongs to the host, survives the party, and is the whole reason it was moved
 * off the event in the first place.
 */
export async function DELETE(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'party:delete', party(eventId));
  if (denied(auth)) return auth.denied;
  if (!eventById(eventId)) return fail(404, 'no such party');
  deleteEvent(eventId);
  return json({ ok: true });
}
