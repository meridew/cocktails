import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr } from '$lib/shared';
import { createEvent, createStaff, eventsForHost, genId } from '$lib/server/db';
import { body, denied, requireAccount } from '$lib/server/guards';

/** The parties this host owns. */
export async function GET(event: RequestEvent) {
  const auth = await requireAccount(event);
  if (denied(auth)) return auth.denied;
  return json({ ok: true, events: eventsForHost(auth.account.id) });
}

/**
 * Create a party — and put the host behind its bar.
 *
 * Both halves matter. Creating the event alone would leave the host owning a row
 * they have no way to work, which is precisely the gap that made signing up lead
 * nowhere: accounts existed, events existed, and nothing joined them.
 *
 * The staff row deliberately carries **no email**. `staff.email` is UNIQUE because
 * it's a login identity, and a host running two parties would collide with
 * themselves. They don't need it: `userId` is their identity here, and they open
 * the bar through their account (see `[id]/bar`).
 */
export async function POST(event: RequestEvent) {
  const auth = await requireAccount(event);
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  const name = cleanStr(b.name, 80) || `${auth.account.name}'s party`;
  const created = createEvent({ hostUserId: auth.account.id, name });

  createStaff({
    id: genId(),
    eventId: created.id,
    userId: auth.account.id,
    displayName: auth.account.name,
    email: null,
    role: 'admin',
    status: 'active',
    joinedVia: 'seed',
  });

  return json({ ok: true, event: created });
}
