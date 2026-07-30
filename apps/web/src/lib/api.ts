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
  StaffClaimResponse,
  StaffListResponse,
  StaffRequestCreated,
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

/** The resource is already gone — usually not an error the user needs to see. */
export class NotFound extends Error {
  constructor() {
    super('not found');
  }
}

/**
 * Auth is injected rather than imported, so this module stays the lowest layer
 * (no cycle with the session store) and callers never thread a token through
 * every signature. The session store registers itself once at startup.
 */
let readToken: () => string = () => '';
let handleUnauthorized: () => void = () => {};

export function configureAuth(hooks: { token: () => string; onUnauthorized: () => void }): void {
  readToken = hooks.token;
  handleUnauthorized = hooks.onUnauthorized;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  // Attached whenever a session exists; public endpoints simply ignore it.
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    // network / DNS / offline — never leak a raw "Failed to fetch"
    throw new Error("Can't reach the bar — check your connection.");
  }

  if (res.status === 401) {
    handleUnauthorized(); // one place decides what an expired session means
    throw new Unauthorized();
  }
  if (res.status === 404) throw new NotFound();
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data?.ok === false) {
    throw new Error(
      (data as { error?: string })?.error ?? `Something went wrong (HTTP ${res.status}).`,
    );
  }
  return data;
}

export const createOrder = (input: NewOrderInput) =>
  req<OrderCreatedResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listOrders = () => req<OrderListResponse>('/orders');

export const setStatus = (id: string, status: OrderStatus) =>
  req<{ ok: true; order: Order }>(`/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const deleteOrder = (id: string) =>
  req<{ ok: boolean }>(`/orders/${id}`, { method: 'DELETE' });

export const clearOrders = (which: ClearWhich) =>
  req<OkResponse>('/orders/clear', {
    method: 'POST',
    body: JSON.stringify({ which }),
  });

// ---- staff auth ----

export const login = (email: string, password: string) =>
  req<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const logout = () => req<OkResponse>('/auth/logout', { method: 'POST' });

/** Who the current session belongs to — used to recover role/name after a reload. */
export const me = () => req<MeResponse>('/auth/me');

// ---- staff: asking to help, and administering who's in ----

export const requestStaffAccess = (name: string, deviceId: string) =>
  req<StaffRequestCreated>('/staff/requests', {
    method: 'POST',
    body: JSON.stringify({ name, deviceId }),
  });

export const claimStaffAccess = (claim: string) =>
  req<StaffClaimResponse>('/staff/claim', { method: 'POST', body: JSON.stringify({ claim }) });

export const listStaff = () => req<StaffListResponse>('/staff');

export const approveStaff = (id: string) =>
  req<OkResponse>(`/staff/${id}/approve`, { method: 'POST' });

/** Deny a pending request, or remove a helper entirely. */
export const removeStaff = (id: string) => req<OkResponse>(`/staff/${id}`, { method: 'DELETE' });

export const revokeStaff = (id: string) =>
  req<OkResponse>(`/staff/${id}/revoke`, { method: 'POST' });

export const revokeAllHelpers = () => req<OkResponse>('/staff/revoke-all', { method: 'POST' });

// ---- Web Push ----

export const pushKey = () => req<{ ok: true; enabled: boolean; key: string }>('/push/key');

export const subscribePush = (body: {
  deviceId: string;
  role: SubscriberRole;
  subscription: unknown;
}) => req<OkResponse>('/subscriptions', { method: 'POST', body: JSON.stringify(body) });
