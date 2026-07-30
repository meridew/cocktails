/**
 * The HTTP layer: routes, middleware, guards. Exported without a listener so
 * tests can drive it in-process via `app.request(...)` — no port, no network.
 * Process bootstrap (seeding + `serve`) lives in `server.ts`.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import type { MiddlewareHandler } from 'hono';
import { cleanItems, cleanStr, isOrderStatus } from '@cocktails/shared';
import type {
  ClearWhich,
  Order,
  PushSubscriptionJSON,
  SubscriberRole,
  OrderCreatedResponse,
  OrderListResponse,
  OkResponse,
  LoginResponse,
  MeResponse,
  Staff,
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
import {
  isAllowedPushEndpoint,
  pushEnabled,
  pushToDevice,
  pushToRole,
  vapidPublicKey,
  type PushPayload,
} from './push.ts';
import { login, logout, loginBlocked, noteLoginAttempt, sessionStaff } from './auth.ts';
import { bearerToken, clientIp } from './http.ts';
import { createRateLimiter } from './ratelimit.ts';

// ---- notification copy (the moments we push on) ----------------------------

/** Guest "your drink" push for a status change — null for moments we skip. */
function guestStatusPush(order: Order): PushPayload | null {
  switch (order.status) {
    case 'making':
      return {
        title: '👩‍🍳 On it!',
        body: `${order.name}, your order is being made.`,
        tag: order.id,
      };
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

/**
 * Validate a client-supplied Web Push subscription, returning a typed value or
 * null. Both keys are required (`web-push` needs p256dh to encrypt, and a missing
 * one would otherwise be stored and then fail silently at send time), and the
 * endpoint must belong to a real push service — see isAllowedPushEndpoint.
 */
function parseSubscription(raw: unknown): PushSubscriptionJSON | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) return null;
  if (typeof keys !== 'object' || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== 'string' || !p256dh) return null;
  if (typeof auth !== 'string' || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// ---- app -------------------------------------------------------------------

type AppEnv = { Variables: { staff: Staff } };
export const app = new Hono<AppEnv>();

// Request logging: without it a failure on the NAS leaves nothing in `docker logs`.
app.use('*', logger());

// Defence-in-depth for the API responses themselves (the site's own headers are
// set by Caddy, which serves the web app).
app.use('*', secureHeaders());

/** Last-resort handler: log the fault, return a generic message, never a stack. */
app.onError((err, c) => {
  console.error(`unhandled error on ${c.req.method} ${c.req.path}:`, err);
  return c.json({ ok: false, error: 'internal error' }, 500);
});

app.use(
  '/api/*',
  cors({
    origin: config.allowedOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// Cap request bodies on the public API (DoS guard) — every endpoint is small JSON.
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ ok: false, error: 'payload too large' }, 413),
  }),
);

const bearer = (c: { req: { header: (n: string) => string | undefined } }): string | undefined =>
  bearerToken(c.req.header('authorization'));

/**
 * Throttle for the unauthenticated write endpoints. Without it, a loop against
 * POST /api/orders both spams the bartender with pushes and — once the order cap
 * is reached — evicts the party's real queue.
 */
const writeLimiter = createRateLimiter({ max: 30, windowMs: 60 * 1000 });

const rateLimitWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = clientIp(c);
  if (writeLimiter.isLimited(ip)) {
    return c.json({ ok: false, error: 'slow down — too many requests' }, 429);
  }
  writeLimiter.record(ip);
  await next();
};

/** Staff-only guard (replaces the old shared PIN). */
const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const staff = sessionStaff(bearer(c));
  if (!staff) return c.json({ ok: false, error: 'unauthorized' }, 401);
  c.set('staff', staff);
  await next();
};

app.get('/api/health', (c) => c.json({ ok: true, now: now() }));

// ---- public: VAPID key so a client can subscribe to Web Push ----
app.get('/api/push/key', (c) =>
  c.json({ ok: true, enabled: pushEnabled(), key: vapidPublicKey() }),
);

// ---- staff auth ----
app.post('/api/auth/login', async (c) => {
  const ip = clientIp(c);
  if (loginBlocked(ip)) {
    return c.json({ ok: false, error: 'too many attempts — try again later' }, 429);
  }
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const email = cleanStr(body?.email, 120);
  const password = typeof body?.password === 'string' ? body.password : '';
  const result = await login(email, password);
  noteLoginAttempt(ip, !!result);
  if (!result) return c.json({ ok: false, error: 'wrong email or password' }, 401);
  return c.json({ ok: true, token: result.token, staff: result.staff } satisfies LoginResponse);
});
app.post('/api/auth/logout', requireStaff, (c) => {
  logout(bearer(c));
  return c.json({ ok: true } satisfies OkResponse);
});
app.get('/api/auth/me', requireStaff, (c) => {
  return c.json({ ok: true, staff: c.get('staff') } satisfies MeResponse);
});

// ---- public: place an order ----
app.post('/api/orders', rateLimitWrites, async (c) => {
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

// ---- public: register a push subscription ----
app.post('/api/subscriptions', rateLimitWrites, async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const deviceId = cleanStr(body?.deviceId, 80);
  // Only authenticated staff may register a 'bartender' subscription — otherwise
  // anyone could enroll and receive guests' order details via push. Else: guest.
  const role: SubscriberRole =
    body?.role === 'bartender' && sessionStaff(bearer(c)) ? 'bartender' : 'guest';
  const subscription = parseSubscription(body?.subscription);
  if (!deviceId || !subscription) {
    return c.json({ ok: false, error: 'invalid subscription' }, 422);
  }
  saveSubscription(deviceId, role, subscription);
  return c.json({ ok: true });
});
