import type { OrderItem } from '@cocktails/shared';
import { LIMITS } from '@cocktails/shared';

// A cross-component reactive store (Svelte 5 runes in a .svelte.ts module).
export const basket = $state<{ items: OrderItem[] }>({ items: [] });

export function addLine(name: string): void {
  const existing = basket.items.find((i) => i.name === name);
  if (existing) existing.qty += 1;
  else basket.items.push({ name, qty: 1 });
}

export function setQty(name: string, qty: number): void {
  const item = basket.items.find((i) => i.name === name);
  if (!item) return;
  if (qty <= 0) basket.items = basket.items.filter((i) => i.name !== name);
  else item.qty = Math.min(qty, LIMITS.maxQty);
}

export function clearBasket(): void {
  basket.items = [];
}

export function basketCount(): number {
  return basket.items.reduce((n, i) => n + i.qty, 0);
}
