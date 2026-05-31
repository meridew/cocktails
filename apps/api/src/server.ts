import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { timingSafeEqual } from 'node:crypto';
import { isOrderStatus, LIMITS } from '@cocktails/shared';
import type { ClearWhich, OrderItem, SubscriberRole } from '@cocktails/shared';
import { config } from './config.ts';
import {
  clearOrders,
  createOrder,
  deleteOrder,
  listOrders,
  now,
  saveSubscription,
  setOrderStatus,
} from './db.ts';

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

function keyOk(sent: string | undefined): boolean {
  if (!sent) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(config.bartenderKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- app -------------------------------------------------------------------

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: config.allowedOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Bartender-Key'],
    maxAge: 86400,
  }),
);

/** Bartender-only guard. */
const requireKey: Parameters<typeof app.use>[1] = async (c, next) => {
  if (!keyOk(c.req.header('x-bartender-key'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  await next();
};

app.get('/api/health', (c) => c.json({ ok: true, now: now() }));

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
  return c.json({ ok: true, id: order.id, order });
});

// ---- bartender: read the queue ----
app.get('/api/orders', requireKey, (c) => {
  return c.json({ ok: true, orders: listOrders(), now: now() });
});

// ---- bartender: change status ----
app.patch('/api/orders/:id', requireKey, async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const status = body?.status;
  if (!isOrderStatus(status)) return c.json({ ok: false, error: 'bad status' }, 422);
  const updated = setOrderStatus(c.req.param('id'), status);
  if (!updated) return c.json({ ok: false, error: 'not found' }, 404);
  // Phase 3: fire the "your drink is being served / INCOMING" push from here.
  return c.json({ ok: true, order: updated });
});

// ---- bartender: delete one ----
app.delete('/api/orders/:id', requireKey, (c) => {
  return c.json({ ok: deleteOrder(c.req.param('id')) });
});

// ---- bartender: bulk clear ----
app.post('/api/orders/clear', requireKey, async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const which: ClearWhich = body?.which === 'all' ? 'all' : 'done';
  clearOrders(which);
  return c.json({ ok: true });
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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`\u{1F378} cocktails API listening on http://localhost:${info.port}`);
});
