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

/**
 * An in-memory `localStorage`.
 *
 * `storage.ts` swallows a missing localStorage and degrades to "nothing persists",
 * which is right in a browser with storage disabled but useless in a test: the
 * behaviour worth asserting for persisted state is precisely that a value written
 * on one visit is read back on the next. This is the smallest shim that lets a test
 * observe a real round-trip.
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  key(i: number): string | null {
    return [...this.#map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.#map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.#map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.#map.delete(k);
  }
  clear(): void {
    this.#map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
