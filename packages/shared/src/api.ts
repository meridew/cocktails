/** Response envelopes the API and client agree on. */
import type { Order } from './orders.ts';
import type { Staff } from './staff.ts';

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
