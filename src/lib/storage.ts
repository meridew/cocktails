/**
 * The one storage seam. Single home for all persisted client state.
 *
 * Synchronous and localStorage-backed today — which also works inside the
 * Capacitor WebView. The native build later hardens the *durable* keys (device
 * id, auth token) to `@capacitor/preferences` by hydrating them into this
 * module at boot, so call sites never change. Swap the driver here, not in a
 * dozen components.
 *
 * Keys are namespaced with `cocktail_` so they don't collide on the origin and
 * match the keys the app has always used (existing device ids/favourites survive).
 */

const PREFIX = 'cocktail_';

function read(name: string): string | null {
  try {
    return localStorage.getItem(PREFIX + name);
  } catch {
    return null; // private-mode / disabled storage — degrade, never throw
  }
}

function write(name: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + name, value);
  } catch {
    /* quota / private-mode — best-effort, never throw at a call site */
  }
}

function remove(name: string): void {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    /* noop */
  }
}

function readJSON<T>(name: string, fallback: T): T {
  const raw = read(name);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // corrupt value → fall back, never throw
  }
}

function writeJSON(name: string, value: unknown): void {
  write(name, JSON.stringify(value));
}

export const storage = { read, write, remove, readJSON, writeJSON };
