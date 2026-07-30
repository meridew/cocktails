/**
 * Loaded via `node --test --import ./tests/setup.ts`.
 *
 * Svelte's runes are compiler-provided globals, so `.svelte.ts` modules can't be
 * imported under plain Node without them. The stores under test only rely on
 * `$state`'s identity behaviour (hold a value), not on reactivity — reactive
 * rendering is covered by svelte-check and manual verification, not unit tests.
 */
// @ts-expect-error — `$state` is a compiler global, not a real declaration.
globalThis.$state = <T>(v: T): T => v;
