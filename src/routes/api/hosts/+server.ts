import { json, type RequestEvent } from '@sveltejs/kit';
import { platform } from '$lib/shared';
import { allUsers, eventsForHost, listStock } from '$lib/server/db';
import { config } from '$lib/server/config';
import { denied, requireCapability } from '$lib/server/guards';

/**
 * Everyone with an account — Dan's list of hosts.
 *
 * Ours rather than Better Auth's `admin` plugin, which would have put this and
 * every other admin power behind the catch-all route that `capabilities.test.ts`
 * declares public. See PLATFORM-PLAN §2e; this endpoint is the thing that decision
 * bought, and it costs about forty lines.
 *
 * Returns enough to render a list without a second call per row: whether they have
 * a cupboard yet and how many parties they've had are the two facts that tell Dan
 * who needs chasing.
 */
export async function GET(event: RequestEvent) {
  const auth = await requireCapability(event, 'host:list', platform());
  if (denied(auth)) return auth.denied;

  return json({
    ok: true,
    hosts: allUsers().map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      role: u.role,
      bannedAt: u.bannedAt,
      banReason: u.banReason,
      createdAt: u.createdAt.getTime(),
      /** Whether they've said anything about their cupboard — see `stock` in schema.ts. */
      hasStock: listStock(u.id).length > 0,
      parties: eventsForHost(u.id).length,
      /**
       * Admin by configuration rather than by a row, so the UI can grey out
       * "remove admin" on someone it would have no effect on: `ADMIN_EMAILS` is
       * re-asserted on every request and the app cannot override it.
       */
      adminByConfig: config.adminEmails.includes(u.email.trim().toLowerCase()),
    })),
  });
}
