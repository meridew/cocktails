import type {
  NewOrderInput,
  Order,
  OrderStatus,
  ClearWhich,
  OrderCreatedResponse,
  OrderListResponse,
  OkResponse,
} from '@cocktails/shared';

// Same-origin: dev → Vite proxy, prod → Caddy. Both route /api to the API.
const BASE = '/api';

export class Unauthorized extends Error {
  constructor() {
    super('unauthorized');
  }
}

async function req<T>(path: string, init: RequestInit = {}, key?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (key) headers.set('X-Bartender-Key', key);

  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    // network / DNS / offline — never leak a raw "Failed to fetch"
    throw new Error("Can't reach the bar — check your connection.");
  }

  if (res.status === 401) throw new Unauthorized();
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data?.ok === false) {
    throw new Error((data as { error?: string })?.error ?? `Something went wrong (HTTP ${res.status}).`);
  }
  return data;
}

export const health = () => req<{ ok: true; now: number }>('/health');

export const createOrder = (input: NewOrderInput) =>
  req<OrderCreatedResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listOrders = (key: string) => req<OrderListResponse>('/orders', {}, key);

export const setStatus = (id: string, status: OrderStatus, key: string) =>
  req<{ ok: true; order: Order }>(`/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }, key);

export const deleteOrder = (id: string, key: string) =>
  req<{ ok: boolean }>(`/orders/${id}`, { method: 'DELETE' }, key);

export const clearOrders = (which: ClearWhich, key: string) =>
  req<OkResponse>('/orders/clear', {
    method: 'POST',
    body: JSON.stringify({ which }),
  }, key);
