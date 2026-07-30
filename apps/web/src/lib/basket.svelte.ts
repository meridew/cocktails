import type { OrderItem } from '@cocktails/shared';
import { LIMITS } from '@cocktails/shared';

// A cross-component reactive store (Svelte 5 runes in a .svelte.ts module).
export const basket = $state<{ items: OrderItem[] }>({ items: [] });

/** Clamp to the bound the server enforces, so both paths agree. */
const clampQty = (qty: number): number => Math.min(qty, LIMITS.maxQty);

export function addLine(name: string): void {
  const existing = basket.items.find((i) => i.name === name);
  // Previously unclamped here while setQty clamped, so repeated taps could push
  // the count past the maximum and get silently reduced by the server.
  if (existing) existing.qty = clampQty(existing.qty + 1);
  else if (basket.items.length < LIMITS.maxItemsPerOrder) basket.items.push({ name, qty: 1 });
}

export function setQty(name: string, qty: number): void {
  const item = basket.items.find((i) => i.name === name);
  if (!item) return;
  if (qty <= 0) basket.items = basket.items.filter((i) => i.name !== name);
  else item.qty = clampQty(qty);
}

export function clearBasket(): void {
  basket.items = [];
}

export function basketCount(): number {
  return basket.items.reduce((n, i) => n + i.qty, 0);
}
