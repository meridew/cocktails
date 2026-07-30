import { redirect } from '@sveltejs/kit';
import { rememberEvent } from '$lib/party';

/**
 * The link behind a host's QR code: remember which party this is, then hand the
 * guest the ordinary menu.
 *
 * Client-only because the whole job is writing to this device's storage — there is
 * nothing for the server to render, and running it on the server would remember the
 * party for nobody.
 */
export const ssr = false;

export function load({ params }: { params: { id: string } }): never {
  rememberEvent(params.id);
  redirect(307, '/');
}
