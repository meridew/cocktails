import { json, type RequestEvent } from '@sveltejs/kit';
import { party } from '$lib/shared';
import { barSessionForAccount } from '$lib/server/auth';
import { userById } from '$lib/server/db';
import { denied, fail, requireCapability } from '$lib/server/guards';

/**
 * Take a bar session at this party, as yourself.
 *
 * **Strictly a convenience now, and worth saying why it still exists.** An Admin
 * holding an account cookie already passes every party capability — `resolveActor`
 * sees the role and `can()` short-circuits — so nothing here is needed to *work* a
 * bar. What it buys is a bearer token, which matters for two reasons: a phone behind
 * a bar keeps a token more comfortably than a cookie it might sign out of, and the
 * keypad needs a staff row to unlock (`signInWithPin` looks one up).
 *
 * It is gated on `orders:advance` rather than on holding an account, because the
 * question this really asks is "may you work this bar" — and that is the capability
 * that means it. A host, who may only watch, is refused: they have no shift to take.
 *
 * A 404 rather than a 403 for a party that isn't yours: the id must not become a way
 * to discover whose parties exist.
 */
export async function POST(event: RequestEvent) {
  const eventId = event.params.id!;
  const auth = await requireCapability(event, 'orders:advance', party(eventId));
  if (denied(auth)) return auth.denied;

  const userId = auth.actor.account?.id;
  if (!userId) return fail(400, 'a bar session needs an account to belong to');

  /*
   * Name the row.
   *
   * `Actor` deliberately carries an id and a role and nothing else, so this has to
   * be looked up — and it used to be skipped, which meant `barSessionForAccount`
   * took its `displayName = ''` default. The staff row it created was real and
   * worked, but it appeared on the Bar staff screen as a blank line with a Revoke
   * button beside it: an unnamed person nobody could account for, on the one screen
   * whose entire job is saying who may pour.
   */
  const account = userById(userId);
  const session = barSessionForAccount(eventId, userId, account?.name ?? '');
  if (!session) return fail(404, 'not found');
  return json({ ok: true, token: session.token, staff: session.staff });
}
