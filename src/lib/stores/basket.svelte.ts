/**
 * The current round. Persisted, because it's the piece of state a guest would
 * actually mourn — locking the phone or reloading mid-party used to lose the
 * whole basket.
 */
import type { OrderItem } from '$lib/shared';
import { LIMITS } from '$lib/shared';
import { storage } from '$lib/storage';

const KEY = 'basket';

function load(): OrderItem[] {
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
