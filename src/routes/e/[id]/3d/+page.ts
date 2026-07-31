import { rememberEvent } from '$lib/party';

/**
 * Same load as the flat menu at `/e/<id>`, deliberately.
 *
 * The 3D view is an alternative *presentation*, not an alternative app: it reads the
 * same menu, fills the same basket and sends through the same endpoint. Anything
 * either view has to do to be at a party — remembering which one this device is at —
 * has to happen identically here, or a guest who switched views would find their
 * round belonged to nobody.
 */
export function load({ params }: { params: { id: string } }): { eventId: string } {
  rememberEvent(params.id);
  return { eventId: params.id };
}
