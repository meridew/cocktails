import { json, type RequestEvent } from '@sveltejs/kit';
import { barSessionForAccount } from '$lib/server/auth';
import { denied, fail, requireAccount } from '$lib/server/guards';

/**
 * Trade an account session for a bar session at an event you're staff on.
 *
 * The bar endpoints all consume a staff session, and rightly so — most of the
 * people behind a bar have no account at all. Rather than teach every one of them
 * to understand a second kind of caller, a host swaps their account session for a
 * staff one here, once.
 *
 * A 404 rather than a 403 when they aren't staff at that event: the id shouldn't
 * become a way to discover whose parties exist.
 */
export async function POST(event: RequestEvent) {
  const auth = await requireAccount(event);
  if (denied(auth)) return auth.denied;

  const session = barSessionForAccount(event.params.id!, auth.account.id);
  if (!session) return fail(404, 'not found');
  return json({ ok: true, token: session.token, staff: session.staff });
}
