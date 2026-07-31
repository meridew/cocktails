/**
 * The current round. Persisted, because it's the piece of state a guest would
 * actually mourn — locking the phone or reloading mid-party used to lose the
 * whole basket.
 *
 * **Scoped to one party.** It used to be a single key, so a round survived walking
 * from one party's menu to another's — verified: a Gimlet added at Ana's birthday
 * was still in the basket on Sam's Saturday, which offers a different set of drinks
 * and might not be able to make it at all. A round belongs to the bar it was built
 * for; carrying it across is not a convenience, it is an order for the wrong bar.
 *
 * Emptying rather than migrating on a change of party, because there is nothing
 * sensible to migrate *to* — the other bar may not stock any of it.
 */
import type { OrderItem } from '$lib/shared';
import { LIMITS } from '$lib/shared';
import { storage } from '$lib/storage';
import { currentEventId } from '$lib/party';

/** Which party's round is in storage, so a change of party can clear it. */
const AT_KEY = 'basket_at';
const KEY = 'basket';

function load(): OrderItem[] {
  // A round left over from another party is not this party's round.
  const at = storage.read(AT_KEY);
  const here = currentEventId();
  if (here && at && at !== here) {
    storage.remove(KEY);
    storage.write(AT_KEY, here);
    return [];
  }
  if (here && !at) storage.write(AT_KEY, here);

  const stored = storage.readJSON<unknown>(KEY, []);
  if (!Array.isArray(stored)) return [];
  // Re-validate: this came from storage and could be stale or hand-edited.
  return stored.flatMap((entry): OrderItem[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, qty } = entry as { name?: unknown; qty?: unknown };
    if (typeof name !== 'string' || !name) return [];
    const n = typeof qty === 'number' && Number.isFinite(qty) ? Math.floor(qty) : 1;
    return [{ name, qty: clampQty(n) }];
  });
}

/** Clamp to the bound the server enforces, so both paths agree. */
function clampQty(qty: number): number {
  return Math.min(Math.max(qty, 1), LIMITS.maxQty);
}

// A cross-component reactive store (Svelte 5 runes in a .svelte.ts module).
export const basket = $state<{ items: OrderItem[] }>({ items: load() });

function persist(): void {
  storage.writeJSON(KEY, basket.items);
  // Stamp which party this round is for, so the next load can tell whether it is
  // still the right one. Written on every change rather than once, because the
  // module may have been loaded before the party was known.
  const here = currentEventId();
  if (here) storage.write(AT_KEY, here);
}

/**
 * Drop a round belonging to another party.
 *
 * Called by the menu once it knows which party it is, because module load can beat
 * the `load()` function's own check: the store is imported by the app shell, which
 * may evaluate before `/e/<id>` has written the id this device is now at.
 */
export function rebaseTo(eventId: string): void {
  const at = storage.read(AT_KEY);
  if (at === eventId) return;
  if (at && basket.items.length > 0) basket.items = [];
  storage.write(AT_KEY, eventId);
  storage.writeJSON(KEY, basket.items);
}

export function addLine(name: string): void {
  const existing = basket.items.find((i) => i.name === name);
  // Clamped here as well as in setQty, so repeated taps can't exceed the maximum
  // and then get silently reduced by the server.
  if (existing) existing.qty = clampQty(existing.qty + 1);
  else if (basket.items.length < LIMITS.maxItemsPerOrder) basket.items.push({ name, qty: 1 });
  persist();
}

export function setQty(name: string, qty: number): void {
  const item = basket.items.find((i) => i.name === name);
  if (!item) return;
  if (qty <= 0) basket.items = basket.items.filter((i) => i.name !== name);
  else item.qty = clampQty(qty);
  persist();
}

export function clearBasket(): void {
  basket.items = [];
  persist();
}

export function basketCount(): number {
  return basket.items.reduce((n, i) => n + i.qty, 0);
}
