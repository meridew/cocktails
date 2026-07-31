import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, platform } from '$lib/shared';
import { deleteUser, now, setUserBan, setUserRole, userById } from '$lib/server/db';
import { config } from '$lib/server/config';
import { body, denied, fail, requireCapability } from '$lib/server/guards';

/** One host, with the two facts only Admin can change about them. */
export async function GET(event: RequestEvent) {
  const auth = await requireCapability(event, 'host:list', platform());
  if (denied(auth)) return auth.denied;

  const host = userById(event.params.id!);
  if (!host) return fail(404, 'no such host');
  return json({ ok: true, host: publicShape(host) });
}

/**
 * Suspend, reinstate, promote or demote.
 *
 * Three capabilities behind one verb, checked per field rather than for the request
 * as a whole — `host:suspend` and `admin:grant` are different powers and a future
 * role might hold one without the other. Doing it this way now means that stays true
 * without anyone having to remember.
 */
export async function PATCH(event: RequestEvent) {
  /**
   * The floor, checked before anything else — and the reason it is here.
   *
   * The first version of this guarded only inside the per-field branches, so a PATCH
   * with an **empty body** matched neither and reached the end having asked nobody
   * for permission. `capabilities.test.ts` caught it on its first run: an anonymous
   * caller got through. Per-field checks are right for what they add; they cannot
   * also be the only thing standing at the door.
   */
  const floor = await requireCapability(event, 'host:list', platform());
  if (denied(floor)) return floor.denied;

  const host = userById(event.params.id!);
  const b = await body(event);

  if ('banned' in b) {
    const auth = await requireCapability(event, 'host:suspend', platform());
    if (denied(auth)) return auth.denied;
    if (!host) return fail(404, 'no such host');
    // Refusing to ban yourself isn't paternalism — it's the one case that locks the
    // operator out of the app with no way back in short of editing the database.
    if (host.id === auth.actor.account?.id) return fail(422, 'you cannot suspend yourself');
    setUserBan(host.id, b.banned ? now() : null, cleanStr(b.reason, 200) || null);
  }

  if ('role' in b) {
    const auth = await requireCapability(event, 'admin:grant', platform());
    if (denied(auth)) return auth.denied;
    if (!host) return fail(404, 'no such host');
    if (b.role !== 'admin' && b.role !== 'host') return fail(422, "role must be 'admin' or 'host'");
    // Demoting an `ADMIN_EMAILS` account would appear to work and change nothing,
    // because config outranks the column on every request. Say so rather than lie.
    if (b.role === 'host' && isAdminByConfig(host.email)) {
      return fail(422, 'that account is an admin by configuration — edit ADMIN_EMAILS');
    }
    setUserRole(host.id, b.role);
  }

  if (!host) return fail(404, 'no such host');
  return json({ ok: true, host: publicShape(userById(host.id)!) });
}

/**
 * Remove an account entirely.
 *
 * Cascades to their parties, cupboard, PIN and sessions by foreign key — which is
 * the point: a host who asks to be deleted should not leave their evening behind in
 * somebody else's database.
 */
export async function DELETE(event: RequestEvent) {
  const auth = await requireCapability(event, 'host:delete', platform());
  if (denied(auth)) return auth.denied;

  const host = userById(event.params.id!);
  if (!host) return fail(404, 'no such host');
  if (host.id === auth.actor.account?.id) return fail(422, 'you cannot delete yourself');
  if (isAdminByConfig(host.email)) {
    // They would be recreated as an admin on their next sign-in anyway, so deleting
    // them destroys their data and changes nothing about their access.
    return fail(422, 'that account is an admin by configuration — edit ADMIN_EMAILS first');
  }

  deleteUser(host.id);
  return json({ ok: true });
}

const isAdminByConfig = (email: string) => config.adminEmails.includes(email.trim().toLowerCase());

const publicShape = (u: NonNullable<ReturnType<typeof userById>>) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  emailVerified: u.emailVerified,
  role: u.role,
  bannedAt: u.bannedAt,
  banReason: u.banReason,
  createdAt: u.createdAt.getTime(),
  adminByConfig: isAdminByConfig(u.email),
});
