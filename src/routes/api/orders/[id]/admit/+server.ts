import { json, type RequestEvent } from '@sveltejs/kit';
import { party } from '$lib/shared';
import { body, denied, fail, requireCapability } from '$lib/server/guards';
import { requirePartyInScope } from '$lib/server/scope';
import { deleteOrder, orderDeviceId, setGuestStatus } from '$lib/server/db';

/**
 * Let in — or turn away — whoever placed this drink.
 *
 * **Keyed on the order, not the person**, because that is what the bar is looking at.
 * A card in the queue says "Marco · 2× Negroni" and offers Admit; the device id
 * behind it never has to reach the client, which keeps it a server concept the way
 * every other part of the app treats it.
 *
 * Admission is on the **guest**, so this releases everything they have ordered and
 * everything they order for the rest of the night — not just the drink that happened
 * to be tapped. Approving somebody's third round as though the bar had never seen
 * them is exactly the tedium this avoids.
 *
 * `{ block: true }` is the other answer: mark them blocked and bin the order. That is
 * the spam case, and it is one tap rather than "delete the order and watch them
 * immediately order again".
 */
export async function POST(event: RequestEvent) {
  const scope = await requirePartyInScope(event);
  if (denied(scope)) return scope.denied;
  const { eventId } = scope;

  const auth = await requireCapability(event, 'guests:admit', party(eventId));
  if (denied(auth)) return auth.denied;

  const orderId = event.params.id!;
  const deviceId = orderDeviceId(eventId, orderId);
  // Null covers both "no such order at this party" and an order with no device.
  // Neither is something to admit, and neither should say which it was.
  if (!deviceId) return fail(404, 'no such order');

  const b = await body(event);
  if (b.block === true) {
    setGuestStatus(eventId, deviceId, 'blocked');
    deleteOrder(eventId, orderId);
    return json({ ok: true, blocked: true });
  }

  setGuestStatus(eventId, deviceId, 'admitted');
  return json({ ok: true, blocked: false });
}
