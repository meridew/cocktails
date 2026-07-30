/**
 * Input sanitising — the single source of truth for both sides.
 *
 * The server calls these to enforce the rules; the client imports the same
 * `LIMITS` to stop a guest typing past them in the first place. Keeping one
 * implementation here is what prevents the two from drifting.
 *
 * The discipline is deliberately "coerce, don't reject": a party guest with a
 * slightly odd payload should still get a drink, so quantities are clamped and
 * unusable items dropped rather than erroring. The one hard requirement (a name
 * and at least one item) is checked by the caller.
 */
import { LIMITS } from './limits';
import type { OrderItem } from './orders';

/**
 * Trim, drop control characters, and cap the length.
 *
 * `\n` and `\t` in free text become spaces rather than vanishing — dropping them
 * outright glued words together ("No ice!\nExtra lime!" → "No ice!Extra lime!").
 * Length is capped by CODE POINT: slicing by UTF-16 unit can cut an astral
 * character (an emoji) in half and leave a lone surrogate in the database.
 */
export function cleanStr(value: unknown, max: number = LIMITS.maxFieldLen): string {
  if (typeof value !== 'string') return '';

  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x09 || code === 0x0d) {
      out += ' ';
    } else if (code < 0x20 || code === 0x7f) {
      continue; // other control characters carry no meaning here
    } else {
      out += ch;
    }
  }

  // Collapse the runs that replacing newlines can create, then trim.
  out = out.replace(/ {2,}/g, ' ').trim();

  const points = [...out];
  return points.length > max ? points.slice(0, max).join('') : out;
}

/** Coerce a quantity into 1..LIMITS.maxQty. */
export function cleanQty(value: unknown): number {
  const qty = Number(value ?? 1);
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return Math.floor(Math.min(qty, LIMITS.maxQty));
}

/** Clean an items array, dropping unusable entries and capping the count. */
export function cleanItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  const items: OrderItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name: rawName, qty: rawQty } = entry as { name?: unknown; qty?: unknown };
    const name = cleanStr(rawName);
    if (!name) continue; // an item with no name can't be made
    items.push({ name, qty: cleanQty(rawQty) });
    if (items.length >= LIMITS.maxItemsPerOrder) break;
  }
  return items;
}
