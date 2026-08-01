import { json, type RequestEvent } from '@sveltejs/kit';
import {
  cleanItems,
  cleanStr,
  party,
  recipeGuideForOrderLine,
  snapshotForOrderLine,
  type OrderCreatedResponse,
  type OrderListResponse,
} from '$lib/shared';
import {
  createOrder,
  eventById,
  listAlcoholOverrides,
  listOrders,
  now,
  QueueFullError,
} from '$lib/server/db';
import { offeredOrderNames } from '$lib/server/menu';
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
   * **Required, because it is what the admission gate hangs on.**
   *
   * A guest is admitted per device (`event_guest`), and `listOrders` shows only
   * admitted ones. An order arriving with no device has nothing to gate on — so
   * without this, omitting one field would be a way straight past the gate and into
   * the working queue, which is the opposite of what it is for.
   *
   * Every real client already sends it: `getDeviceId()` mints one on first use and
   * it is how a guest gets told their drink is ready.
   */
  if (!deviceId) return fail(422, 'deviceId required');

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
  const found = asked ? eventById(asked) : null;
  if (!found) return fail(404, 'no such party');

  /**
   * **Only a live party takes orders.**
   *
   * Status used to be decorative: this endpoint never looked at it, so `Open` and
   * `Close` on the admin screen changed a label and nothing else — a closed bar
   * accepted drinks exactly like an open one. Found by Dan creating the first real
   * party and it sitting in `draft` while its link worked.
   *
   * **409, not 403.** Nothing is wrong with the caller or their request; the party is
   * in a state that doesn't accept one. A 403 would say "you may not", which invites
   * a guest to go looking for permission they don't need.
   *
   * The two messages differ because the two situations do, and a guest can act on
   * one of them: "not open yet" means wait, "closed" means stop.
   */
  if (found.status !== 'live') {
    return fail(409, found.status === 'done' ? 'the bar has closed' : "this party isn't open yet");
  }
  const eventId = found.id;

  const offered = offeredOrderNames(found);
  const unavailable = items.find((item) => !offered.has(item.name));
  if (unavailable) return fail(422, `${unavailable.name} is not on this party's menu`);

  const alcohol = listAlcoholOverrides(found.hostUserId);
  const guidedItems = items.map((item) => {
    const guide = recipeGuideForOrderLine(item.name);
    return {
      ...item,
      ...(guide ? { guide } : {}),
      unit: snapshotForOrderLine(item.name, alcohol),
    };
  });
  let order;
  try {
    order = createOrder(eventId, { name, items: guidedItems, note, deviceId });
  } catch (error) {
    if (error instanceof QueueFullError) return fail(503, 'the bar queue is full');
    throw error;
  }
  void pushToRole('bartender', newOrderPush(order)); // fire-and-forget
  return json({ ok: true, id: order.id, order } satisfies OrderCreatedResponse);
}
