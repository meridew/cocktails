import { json, type RequestEvent } from '@sveltejs/kit';
import {
  cleanItems,
  cleanStr,
  party,
  type OrderCreatedResponse,
  type OrderListResponse,
} from '$lib/shared';
import { createOrder, eventById, listOrders, now } from '$lib/server/db';
import { newOrderPush } from '$lib/server/notify';
import { pushToRole } from '$lib/server/push';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';
import { rateLimitWrites } from '$lib/server/ratelimit';

/**
 * The queue for one party.
 *
 * Which party is named by the caller — `?eventId=`, or implied by a bar session —
 * rather than inferred from "whichever is live". Several parties run at once now, so
 * an inference would be wrong silently, which is the worst way for it to be wrong.
 */
export async function GET(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;

  const auth = await requireCapability(event, 'orders:read', party(eventId));
  if (denied(auth)) return auth.denied;

  return json({ ok: true, orders: listOrders(eventId), now: now() } satisfies OrderListResponse);
}

/** Public: a guest places a round. No account, just a device id. */
export async function POST(event: RequestEvent) {
  const limited = rateLimitWrites(event);
  if (limited) return limited;

  const b = await body(event);
  const name = cleanStr(b.name);
  const note = cleanStr(b.note, 200);
  const items = cleanItems(b.items);
  const deviceId = cleanStr(b.deviceId, 80) || undefined;
  if (!name || items.length === 0) {
    return fail(422, 'name and at least one item required');
  }

  /**
   * Which party this drink is for.
   *
   * The guest's link names it, because "whichever event happens to be live" sends
   * people to the wrong bar the moment two hosts are running at once — silently,
   * which is the worst way for it to be wrong. The id isn't a secret: it travels in
   * the QR code, and ordering at a party you were invited to is the whole point.
   *
   * **There is no fallback.** It used to drop the drink into "whichever party is
   * live", which was right while there was one and silently wrong the moment two ran
   * at once — the guest orders at a stranger's bar and nothing says so. Several
   * parties running is now the normal case, so an unnamed party is an error.
   */
  const asked = cleanStr(b.eventId, 40);
  const eventId = asked ? eventById(asked)?.id : null;
  if (!eventId) return fail(404, 'no such party');

  const order = createOrder(eventId, { name, items, note, deviceId });
  void pushToRole('bartender', newOrderPush(order)); // fire-and-forget
  return json({ ok: true, id: order.id, order } satisfies OrderCreatedResponse);
}
