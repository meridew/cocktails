/**
 * @cocktails/shared — the single source of truth for types shared between
 * the web app (Svelte/Vite) and the API (Hono/Node). Keeping the order shape,
 * statuses and API contracts here is what stops the front and back drifting.
 */

// ---- Orders ----------------------------------------------------------------

/** Lifecycle of an order on the bar. `serving` is the "🍹 INCOMING" moment. */
export type OrderStatus = 'pending' | 'making' | 'serving' | 'done';

export const ORDER_STATUSES = ['pending', 'making', 'serving', 'done'] as const;

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

/**
 * Per-status metadata: sort rank, bartender badge text, human label, and the
 * primary forward transition. One table so adding/!changing a status is a
 * single edit shared by the API and the bartender UI (no parallel maps).
 */
export interface StatusMeta {
  rank: number;
  badge: string;
  label: string;
  next: OrderStatus | null;
  nextLabel: string | null;
}

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending: { rank: 0, badge: 'NEW', label: 'New', next: 'making', nextLabel: '▶ Start' },
  making: { rank: 1, badge: 'MAKING', label: 'Making', next: 'serving', nextLabel: '🍹 Serve' },
  serving: { rank: 2, badge: 'INCOMING', label: 'Serving', next: 'done', nextLabel: '✓ Done' },
  done: { rank: 3, badge: 'DONE', label: 'Done', next: null, nextLabel: null },
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

// ---- Push subscriptions (Phase 3) -----------------------------------------

export type SubscriberRole = 'guest' | 'bartender';

/** How a push is delivered. Web Push for browsers/PWAs; native tokens for the apps. */
export type SubscriptionTransport = 'webpush' | 'fcm' | 'apns';

/** Where the subscriber is running. */
export type Platform = 'web' | 'ios' | 'android';

/** A W3C PushSubscription as stored server-side. */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SubscriptionRecord {
  deviceId: string;
  role: SubscriberRole;
  /** Web Push subscription today; broadens to a native token payload in the app. */
  subscription: PushSubscriptionJSON;
  transport: SubscriptionTransport;
  platform: Platform;
  createdAt: number;
}

// ---- API envelopes ---------------------------------------------------------

export interface ApiError {
  ok: false;
  error: string;
}

export interface OrderListResponse {
  ok: true;
  orders: Order[];
  now: number;
}

export interface OrderCreatedResponse {
  ok: true;
  id: string;
  order: Order;
}

export interface OkResponse {
  ok: true;
}

// ---- Staff auth ------------------------------------------------------------

/** A logged-in staff member (no secrets). */
export interface Staff {
  email: string;
  role: string;
}

export interface LoginResponse {
  ok: true;
  /** bearer session token — sent as `Authorization: Bearer …` on staff calls */
  token: string;
  staff: Staff;
}

export interface MeResponse {
  ok: true;
  staff: Staff;
}

// ---- Menu (filled with data during the UI port) ----------------------------

export interface MenuItem {
  id: string;
  name: string;
  blurb?: string;
  recipe?: string;
  emoji?: string;
}

export interface MenuSection {
  id: string;
  title: string;
  /** true for the alcohol-free tab */
  alcoholFree?: boolean;
  items: MenuItem[];
}

// ---- Limits (shared so client and server agree) ----------------------------

export const LIMITS = {
  maxOrders: 500,
  maxItemsPerOrder: 50,
  maxFieldLen: 140,
  maxQty: 99,
} as const;
