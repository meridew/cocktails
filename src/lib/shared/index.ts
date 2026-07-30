/**
 * @cocktails/shared — the single source of truth for everything the web app
 * (Svelte/Vite) and the API (Hono/Node) must agree on: the order shape and its
 * lifecycle, push-subscription records, response envelopes, the limits, and the
 * input sanitising both sides apply. Keeping these here is what stops the front
 * and back drifting.
 *
 * Barrel only — no declarations of its own, so each concern lives in one module.
 */
export * from './limits';
export * from './orders';
export * from './staff';
export * from '$lib/stores/push.svelte';
export * from '$lib/api';
export * from './sanitise';
