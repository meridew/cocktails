import { json, type RequestEvent } from '@sveltejs/kit';
import { isHandoff, isOrderStatus, type Handoff } from '$lib/shared';
import { deleteOrder, orderDeviceId, setOrderStatus } from '$lib/server/db';
import { guestStatusPush } from '$lib/server/notify';
import { pushToDevice } from '$lib/server/push';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/** Move an order along, optionally saying how the drink reaches the guest. */
export async function PATCH(event: RequestEvent) {
  const auth = requireCapability(event, 'orders:advance');
  if (denied(auth)) return auth.denied;

  const b = await body(event);
  if (!isOrderStatus(b.status)) return fail(422, 'bad status');
  // Optional, and anything unrecognised is dropped rather than rejected — an old
  // client that knows nothing about handoffs must keep working.
  const handoff: Handoff | undefined = isHandoff(b.handoff) ? b.handoff : undefined;

  const updated = setOrderStatus(auth.staff.eventId, event.params.id!, b.status, handoff);
  if (!updated) return fail(404, 'not found');

  // Notify the guest on the moments that matter (making, then ready).
  const payload = guestStatusPush(updated);
  if (payload) {
    const device = orderDeviceId(auth.staff.eventId, updated.id);
    if (device) void pushToDevice(device, payload); // fire-and-forget
  }
  return json({ ok: true, order: updated });
}

export function DELETE(event: RequestEvent) {
  const auth = requireCapability(event, 'orders:delete');
  if (denied(auth)) return auth.denied;
  if (!deleteOrder(auth.staff.eventId, event.params.id!)) return fail(404, 'not found');
  return json({ ok: true });
}
