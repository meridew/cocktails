/**
 * Loaded via `node --test --import ./tests/setup.ts`.
 *
 * Must run before any test module graph is evaluated: static imports are hoisted,
 * so setting DB_PATH at the top of a test file would happen *after* config.ts had
 * already frozen it. Keeping it here (rather than in the CI workflow) means local
 * and CI runs behave identically.
 *
 * Note: with VAPID keys unset, `push.ts` is disabled and the suite makes zero
 * outbound requests. Do not add VAPID_* to the test env — it would turn every
 * order-status test into a network flake.
 */
process.env.DB_PATH ??= ':memory:';
