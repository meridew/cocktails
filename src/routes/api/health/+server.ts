import { json } from '@sveltejs/kit';
import { now } from '$lib/server/db';

/** Liveness probe — the container healthcheck and deploy verification hit this. */
export const GET = () => json({ ok: true, now: now() });
