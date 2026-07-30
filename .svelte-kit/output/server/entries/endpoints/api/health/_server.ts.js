import { json } from '@sveltejs/kit';
const GET = () => json({ ok: true, now: Date.now() });
export { GET };
