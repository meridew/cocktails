import { json, type RequestEvent } from '@sveltejs/kit';
import { ensureLiveEvent } from '$lib/server/auth';
import {
  cleanItems,
  cleanStr,
  type OrderCreatedResponse,
  type OrderListResponse,
} from '$lib/shared';
import { createOrder, listOrders, now } from '$lib/server/db';
import { newOrderPush } from '$lib/server/notify';
import { pushToRole } from '$lib/server/push';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { rateLimitWrites } from '$lib/server/ratelimit';

/** The bar's queue. */
export function GET(event: RequestEvent) {
  const auth = requireCapability(event, 'orders:read');
  if (denied(auth)) return auth.denied;
  return json({
    ok: true,
    orders: listOrders(auth.staff.eventId),
    now: now(),
  } satisfies OrderListResponse);
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
  const order = createOrder(ensureLiveEvent(), { name, items, note, deviceId });
  void pushToRole('bartender', newOrderPush(order)); // fire-and-forget
  return json({ ok: true, id: order.id, order } satisfies OrderCreatedResponse);
}
