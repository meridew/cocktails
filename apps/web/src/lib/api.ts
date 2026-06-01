import type {
  NewOrderInput,
  Order,
  OrderStatus,
  ClearWhich,
  SubscriberRole,
  OrderCreatedResponse,
  OrderListResponse,
  OkResponse,
  LoginResponse,
  MeResponse,
} from '@cocktails/shared';

// Same-origin by default: dev → Vite proxy, prod → Caddy, both route /api.
// The native (Capacitor) build has no same-origin server, so it sets
// VITE_API_BASE to the public HTTPS origin (including the /api suffix).
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class Unauthorized extends Error {
  constructor() {
    super('unauthorized');
  }
}

async function req<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

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

export const listOrders = (token: string) => req<OrderListResponse>('/orders', {}, token);

export const setStatus = (id: string, status: OrderStatus, token: string) =>
  req<{ ok: true; order: Order }>(`/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }, token);

export const deleteOrder = (id: string, token: string) =>
  req<{ ok: boolean }>(`/orders/${id}`, { method: 'DELETE' }, token);

export const clearOrders = (which: ClearWhich, token: string) =>
  req<OkResponse>('/orders/clear', {
    method: 'POST',
    body: JSON.stringify({ which }),
  }, token);

// ---- staff auth ----

export const login = (email: string, password: string) =>
  req<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const logout = (token: string) => req<OkResponse>('/auth/logout', { method: 'POST' }, token);

export const me = (token: string) => req<MeResponse>('/auth/me', {}, token);

// ---- Web Push ----

export const pushKey = () => req<{ ok: true; enabled: boolean; key: string }>('/push/key');

export const subscribePush = (
  body: { deviceId: string; role: SubscriberRole; subscription: unknown },
  token?: string,
) => req<OkResponse>('/subscriptions', { method: 'POST', body: JSON.stringify(body) }, token);
