/** Response envelopes and the staff-auth payloads the API and client agree on. */
import type { Order } from './orders.ts';

export interface OkResponse {
  ok: true;
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
