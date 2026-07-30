import { json } from '@sveltejs/kit';

/** Liveness probe — the container healthcheck and the deploy verification hit this. */
export const GET = () => json({ ok: true, now: Date.now() });
