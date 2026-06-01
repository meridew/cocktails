import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { isOrderStatus, LIMITS } from '@cocktails/shared';
import type {
  ClearWhich,
  Order,
  OrderItem,
  SubscriberRole,
  OrderCreatedResponse,
  OrderListResponse,
  OkResponse,
  LoginResponse,
  MeResponse,
} from '@cocktails/shared';
import { config } from './config.ts';
import {
  clearOrders,
  createOrder,
  deleteOrder,
  listOrders,
  now,
  orderDeviceId,
  saveSubscription,
  setOrderStatus,
} from './db.ts';
import { pushEnabled, pushToDevice, pushToRole, vapidPublicKey, type PushPayload } from './push.ts';
import { login, logout, seedStaff, sessionStaff } from './auth.ts';

// ---- notification copy (the moments we push on) ----------------------------

/** Guest "your drink" push for a status change — null for moments we skip. */
function guestStatusPush(order: Order): PushPayload | null {
  switch (order.status) {
    case 'making':
      return { title: '👩‍🍳 On it!', body: `${order.name}, your order is being made.`, tag: order.id };
    case 'serving':
      return { title: '🍹 INCOMING!', body: `${order.name}, come grab your drink!`, tag: order.id };
    default:
      return null; // pending/done: no push (done → "how was it?" comes later)
  }
}

/** Bartender push when a new order lands. */
function newOrderPush(order: Order): PushPayload {
  const summary = order.items.map((i) => `${i.qty}× ${i.name}`).join(', ');
  return { title: '🔔 New order', body: `${order.name}: ${summary}`, tag: order.id };
}

// ---- validation helpers (mirror the old PHP sanitising) --------------------

/** Drop ASCII control chars, trim, and cap length. */
function cleanStr(v: unknown, max: number = LIMITS.maxFieldLen): string {
  if (typeof v !== 'string') return '';
  let s = '';
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    s += ch;
  }
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function cleanItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderItem[] = [];
  for (const it of raw) {
    if (typeof it !== 'object' || it === null) continue;
    const name = cleanStr((it as Record<string, unknown>).name);
    if (!name) continue;
    let qty = Number((it as Record<string, unknown>).qty ?? 1);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > LIMITS.maxQty) qty = LIMITS.maxQty;
    out.push({ name, qty: Math.floor(qty) });
    if (out.length >= LIMITS.maxItemsPerOrder) break;
  }
  return out;
}

// ---- app -------------------------------------------------------------------

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: config.allowedOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

/** Pull the bearer token from the Authorization header. */
function bearer(c: Context): string | undefined {
  const h = c.req.header('authorization');
  return h && /^bearer /i.test(h) ? h.slice(7) : undefined;
}

/** Staff-only guard (replaces the old shared PIN). */
const requireStaff: Parameters<typeof app.use>[1] = async (c, next) => {
  if (!sessionStaff(bearer(c))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  await next();
};

app.get('/api/health', (c) => c.json({ ok: true, now: now() }));

// ---- public: VAPID key so a client can subscribe to Web Push ----
app.get('/api/push/key', (c) => c.json({ ok: true, enabled: pushEnabled(), key: vapidPublicKey() }));

// ---- staff auth ----
app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const email = cleanStr(body?.email, 120);
  const password = typeof body?.password === 'string' ? body.password : '';
  const result = login(email, password);
  if (!result) return c.json({ ok: false, error: 'wrong email or password' }, 401);
  return c.json({ ok: true, token: result.token, staff: result.staff } satisfies LoginResponse);
});
app.post('/api/auth/logout', requireStaff, (c) => {
  logout(bearer(c));
  return c.json({ ok: true } satisfies OkResponse);
});
app.get('/api/auth/me', requireStaff, (c) => {
  return c.json({ ok: true, staff: sessionStaff(bearer(c))! } satisfies MeResponse);
});

// ---- public: place an order ----
app.post('/api/orders', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const name = cleanStr(body?.name);
  const note = cleanStr(body?.note);
  const items = cleanItems(body?.items);
  const deviceId = cleanStr(body?.deviceId, 80) || undefined;
  if (!name || items.length === 0) {
    return c.json({ ok: false, error: 'name and at least one item required' }, 422);
  }
  const order = createOrder({ name, items, note, deviceId });
  void pushToRole('bartender', newOrderPush(order)); // fire-and-forget
  return c.json({ ok: true, id: order.id, order } satisfies OrderCreatedResponse);
});

// ---- bartender: read the queue ----
app.get('/api/orders', requireStaff, (c) => {
  return c.json({ ok: true, orders: listOrders(), now: now() } satisfies OrderListResponse);
});

// ---- bartender: change status ----
app.patch('/api/orders/:id', requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const status = body?.status;
  if (!isOrderStatus(status)) return c.json({ ok: false, error: 'bad status' }, 422);
  const updated = setOrderStatus(c.req.param('id'), status);
  if (!updated) return c.json({ ok: false, error: 'not found' }, 404);
  // Notify the guest's device on the moments that matter (making → serving).
  const payload = guestStatusPush(updated);
  if (payload) {
    const dev = orderDeviceId(updated.id);
    if (dev) void pushToDevice(dev, payload); // fire-and-forget
  }
  return c.json({ ok: true, order: updated });
});

// ---- bartender: delete one ----
app.delete('/api/orders/:id', requireStaff, (c) => {
  return c.json({ ok: deleteOrder(c.req.param('id')) });
});

// ---- bartender: bulk clear ----
app.post('/api/orders/clear', requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const which: ClearWhich = body?.which === 'all' ? 'all' : 'done';
  clearOrders(which);
  return c.json({ ok: true } satisfies OkResponse);
});

// ---- public: register a push subscription (Phase 3 plumbing) ----
app.post('/api/subscriptions', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const deviceId = cleanStr(body?.deviceId, 80);
  const role: SubscriberRole = body?.role === 'bartender' ? 'bartender' : 'guest';
  const sub = body?.subscription as { endpoint?: unknown; keys?: { auth?: unknown } } | undefined;
  if (!deviceId || typeof sub?.endpoint !== 'string' || typeof sub?.keys?.auth !== 'string') {
    return c.json({ ok: false, error: 'invalid subscription' }, 422);
  }
  saveSubscription(deviceId, role, sub as never);
  return c.json({ ok: true });
});

seedStaff();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`\u{1F378} cocktails API listening on http://localhost:${info.port}`);
});
