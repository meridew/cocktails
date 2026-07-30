/**
 * @cocktails/shared — the single source of truth for everything the web app
 * (Svelte/Vite) and the API (Hono/Node) must agree on: the order shape and its
 * lifecycle, push-subscription records, response envelopes, the limits, and the
 * input sanitising both sides apply. Keeping these here is what stops the front
 * and back drifting.
 *
 * Barrel only — no declarations of its own, so each concern lives in one module.
 */
export * from './limits.ts';
export * from './orders.ts';
export * from './push.ts';
export * from './api.ts';
export * from './sanitise.ts';
