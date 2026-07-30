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
    actionClass: 'start',
  },
  making: {
    rank: 1,
    badge: 'MAKING',
    label: 'Making',
    next: 'serving',
    nextLabel: '🍹 Serve',
    actionClass: 'serve',
  },
  serving: {
    rank: 2,
    badge: 'INCOMING',
    label: 'Serving',
    next: 'done',
    nextLabel: '✓ Done',
    actionClass: 'done',
  },
  done: {
    rank: 3,
    badge: 'DONE',
    label: 'Done',
    next: null,
    nextLabel: null,
    actionClass: '',
  },
};

export interface OrderItem {
  name: string;
  qty: number;
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
