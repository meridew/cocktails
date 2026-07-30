import { json } from '@sveltejs/kit';
import { pushEnabled, vapidPublicKey } from '$lib/server/push';

/** Public: the VAPID key a client needs in order to subscribe. */
export const GET = () => json({ ok: true, enabled: pushEnabled(), key: vapidPublicKey() });
