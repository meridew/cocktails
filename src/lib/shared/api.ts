import type { Actor } from './permissions';
/** Response envelopes the API and client agree on. */
import type { Order } from './orders';
import type { Staff } from './staff';

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
  /**
   * Who the caller is, in the shape `can()` takes. Deliberately not a staff row:
   * the client and the server now reason about the same object, so a control that
   * renders is one the server will honour.
   */
  actor: Actor;
}
