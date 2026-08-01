/**
 * $lib/shared — the single source of truth for everything the browser and the
 * server must agree on: the order shape and its lifecycle, push-subscription
 * records, response envelopes, the limits, and the input sanitising both sides
 * apply. Keeping these here is what stops the two drifting.
 *
 * Note the sibling imports below stay relative. `./push` and `./api` here are the
 * *shared* modules; $lib also has a client-side push store and an API client with
 * the same names, and pointing at those would be silently circular.
 *
 * Barrel only — no declarations of its own, so each concern lives in one module.
 */
export * from './limits';
export * from './orders';
export * from './staff';
export * from './permissions';
export * from './push';
export * from './api';
export * from './recipes';
export * from './recipe-guide';
export * from './sanitise';
export * from './party';
export * from './alcohol';
export * from './analytics';
export * from './notifications';
