import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, platform } from '$lib/shared';
import { allEvents, createEvent, eventsForHost, userById } from '$lib/server/db';
import { body, denied, fail, requireCapability, whoami } from '$lib/server/guards';

/**
 * The parties you can see: **all of them if you're Admin, your own if you're a host.**
 *
 * Not a capability check, because there is no capability for "see your own things" —
 * that isn't a permission, it's what the list *is*. The filter is the answer.
 */
export async function GET(event: RequestEvent) {
  const actor = await whoami(event);
  if (!actor.account) return fail(401, 'sign in to do that');
  return json({
    ok: true,
    events: actor.account.role === 'admin' ? allEvents() : eventsForHost(actor.account.id),
  });
}

/**
 * Create a party, for a host.
 *
 * **Admin only, and the host must already exist.** A booking is a conversation, so
 * Dan makes the event; and the menu is generated from the *host's* cupboard, so a
 * party without an owner would be a party with no menu. Both halves of that are why
 * `event.hostUserId` is NOT NULL now.
 *
 * It deliberately does not create a `staff` row for the host. They are a customer:
 * they watch their queue through their account, and `resolveActor` gives them
 * `owner` at their own party without anyone being added to a shift.
 */
export async function POST(event: RequestEvent) {
  const auth = await requireCapability(event, 'party:create', platform());
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  const hostUserId = cleanStr(b.hostUserId, 64);
  if (!hostUserId) return fail(422, 'hostUserId required');

  const host = userById(hostUserId);
  if (!host) return fail(404, 'no such host');

  const name = cleanStr(b.name, 80) || `${host.name}'s party`;
  const startsAt = typeof b.startsAt === 'number' ? b.startsAt : null;

  // Born `draft`: a party goes live when Dan says so, on the night. Nothing infers
  // it from the date, because a mistyped date would lock the guests out.
  return json({ ok: true, event: createEvent({ hostUserId, name, startsAt }) });
}
