/** Orders: their lifecycle, shape, and the per-status metadata both sides read. */

/** Lifecycle of an order on the bar. `serving` is the "🍹 INCOMING" moment. */
export type OrderStatus = 'pending' | 'making' | 'serving' | 'done';

export const ORDER_STATUSES = ['pending', 'making', 'serving', 'done'] as const;

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

/**
 * Per-status metadata: sort rank, bartender badge text, human label, the primary
 * forward transition, and the CSS modifier for its action button. One table so
 * adding or changing a status is a single edit shared by the API and the UI — no
 * parallel per-status maps anywhere else.
 */
export interface StatusMeta {
  rank: number;
  badge: string;
  label: string;
  next: OrderStatus | null;
  nextLabel: string | null;
  /** One step backwards, to undo a mis-tap. null at the start of the chain. */
  prev: OrderStatus | null;
  /** CSS modifier for the forward-action button (see neo.css / app.css). */
  actionClass: string;
}

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending: {
    rank: 0,
    badge: 'NEW',
    label: 'New',
    next: 'making',
    nextLabel: '▶ Start',
    prev: null,
    actionClass: 'start',
  },
  making: {
    rank: 1,
    badge: 'MAKING',
    label: 'Making',
    next: 'serving',
    // Deliberately neutral: this is the tap that notifies the guest, and not every
    // drink is collected from the bar. Saying *how* it reaches them is the optional
    // handoff choice on the expanded card — see HANDOFF_META.
    nextLabel: '🍹 Ready',
    prev: 'pending',
    actionClass: 'serve',
  },
  serving: {
    rank: 2,
    badge: 'INCOMING',
    label: 'Serving',
    next: 'done',
    nextLabel: '✓ Done',
    prev: 'making',
    actionClass: 'done',
  },
  done: {
    rank: 3,
    badge: 'DONE',
    label: 'Done',
    next: null,
    nextLabel: null,
    prev: 'serving',
    actionClass: '',
  },
};

/**
 * How a served drink reaches the guest. Not every party works the same way: at
 * some the bar calls you over, at others someone walks it to you — so the guest's
 * "it's ready" notification must not assume collection.
 *
 * Null/absent means the bar didn't say, and the wording stays neutral.
 */
export type Handoff = 'collect' | 'deliver';

export const HANDOFFS = ['collect', 'deliver'] as const;

export function isHandoff(v: unknown): v is Handoff {
  return typeof v === 'string' && (HANDOFFS as readonly string[]).includes(v);
}

/**
 * Bar-facing presentation for each handoff. The guest-facing notification wording
 * is the API's business (it owns all push copy) — this table is only the buttons.
 */
export const HANDOFF_META: Record<
  Handoff,
  { label: string; icon: string; note: string; actionClass: string }
> = {
  collect: { label: '🍹 At the bar', icon: '🍹', note: 'told to collect', actionClass: 'serve' },
  deliver: { label: '🛎 Take it over', icon: '🛎', note: 'being delivered', actionClass: 'deliver' },
};

export interface OrderItem {
  name: string;
  qty: number;
  /**
   * How many of this line have actually been poured. Optional and defaulted to 0
   * so every order written before per-drink tracking existed stays valid.
   */
  made?: number;
}

export interface Order {
  id: string;
  name: string;
  items: OrderItem[];
  note: string;
  status: OrderStatus;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
  /**
   * When this order was pushed to the front of the queue, or null. Bumped orders
   * sort ahead of everything else, most-recently-bumped first.
   */
  bumpedAt?: number | null;
  /**
   * How this drink is reaching the guest, once the bar has said. Null until then,
   * and on every order placed before handoffs existed.
   */
  handoff?: Handoff | null;
  /**
   * True while the bar has not yet let this guest in.
   *
   * The card offers **Admit** instead of **Start**, and nothing else about the order
   * changes — it sits in the same queue, in the same place, saying the same thing.
   * Hiding it was the first design and the wrong one: an order nobody can see is an
   * order nobody notices going missing.
   *
   * A boolean rather than the device id, because the bar acts on the *order* in
   * front of it (`POST /api/orders/[id]/admit`) and never needs to learn which
   * device placed it.
   */
  newGuest?: boolean;
  /**
   * The content hash of this guest's selfie, or null if they haven't taken one.
   *
   * **A hash, not the picture.** The bar re-polls every four seconds; inlining even a
   * six-kilobyte avatar per order would be a hundred kilobytes of identical bytes a
   * minute. `Avatar.svelte` fetches each hash once and keeps it, which it can only do
   * because the hash is of the *content* — the URL can never mean a different face.
   */
  photoId?: string | null;
}

/** Drinks poured vs ordered, for a progress readout on a multi-drink order. */
export function orderProgress(order: Order): { made: number; total: number; complete: boolean } {
  let made = 0;
  let total = 0;
  for (const item of order.items) {
    total += item.qty;
    made += Math.min(item.made ?? 0, item.qty);
  }
  return { made, total, complete: total > 0 && made >= total };
}

/** What a guest sends to place an order. */
export interface NewOrderInput {
  name: string;
  items: OrderItem[];
  note?: string;
  /** anonymous device id (localStorage) so we can push "your drink" back to them */
  deviceId?: string;
}

export type ClearWhich = 'done' | 'all';
