import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { and, eq } from 'drizzle-orm';
import type { NotificationContent, PushSubscriptionJSON } from '$lib/shared';
import {
  createDb,
  createOrder,
  createStaff,
  createStaffSession,
  dbTransaction,
  deleteEvent,
  deleteStaffSession,
  genId,
  listOrders,
  orm,
  staffByIdUnscoped,
  type TrustedStaffId,
} from '$lib/server/db';
import { declarativePayload, notificationPolicy, topicFor } from '$lib/server/notify';
import { classifyPushFailure, parseRetryAfter, retryDelayMs } from '$lib/server/push';
import {
  claimDeliveries,
  deliveryForSend,
  enqueueNotification,
  expireQueuedDeliveries,
  markDeliveryAccepted,
  recordReceipt,
  receiptTokenForDelivery,
  registerPushEndpoint,
  setNotificationMode,
  subscriptionForDelivery,
} from '$lib/server/notification-store';
import {
  notificationDailyAggregate,
  notificationDelivery,
  notificationMessage,
  pushAudience,
  pushEndpoint,
  subscriptions,
} from '$lib/server/schema';
import { request, send } from './app';
import {
  asAccount,
  helper,
  partyFor,
  person,
  useMemoryEmail,
  type Account,
} from './fixtures/people';

const sub = (suffix: string, key = 'p256dh'): PushSubscriptionJSON => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
  keys: { p256dh: key, auth: `auth-${suffix}` },
});

const content = (eventId: string, entityId = genId()): NotificationContent => ({
  kind: 'bartender-order',
  eventId,
  entityId,
  title: 'New order',
  body: 'A private rendered body',
  url: `/bar/${eventId}`,
  tag: entityId,
});

let admin: Account;
let hostA: Account;
let hostB: Account;
let eventA = '';
let eventB = '';
let hostEventA = '';
let hostEventB = '';

beforeAll(async () => {
  useMemoryEmail();
  admin = await person('notification-reliability', 'admin');
  hostA = await person('notification-host-a');
  hostB = await person('notification-host-b');
  eventA = partyFor(admin.id, 'Notification A');
  eventB = partyFor(admin.id, 'Notification B');
  hostEventA = partyFor(hostA.id, 'Host notification A');
  hostEventB = partyFor(hostB.id, 'Host notification B');
  setNotificationMode('paused', admin.id);
});

describe('notification API tenancy and capabilities', () => {
  test('party health is owner/admin only and preserves cross-party not-found behavior', async () => {
    const own = await request(`/api/events/${hostEventA}/notification-health`, {
      headers: asAccount(hostA),
    });
    assert.equal(own.status, 200);
    const cross = await request(`/api/events/${hostEventB}/notification-health`, {
      headers: asAccount(hostA),
    });
    assert.equal(cross.status, 404);
    const adminView = await request(`/api/events/${hostEventA}/notification-health`, {
      headers: asAccount(admin),
    });
    assert.equal(adminView.status, 200);
    assert.equal((await request(`/api/events/${hostEventA}/notification-health`)).status, 401);
  });

  test('staff cannot read party health and hosts cannot change delivery mode', async () => {
    const token = await helper(admin, eventA, 'Notification helper', `helper-${genId()}`);
    const staffView = await request(`/api/events/${eventA}/notification-health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(staffView.status, 403);
    const hostControl = await request('/api/admin/notification-control', {
      ...send('PUT', { mode: 'live' }),
      headers: { 'Content-Type': 'application/json', ...asAccount(hostA) },
    });
    assert.equal(hostControl.status, 403);
  });

  test('self-test and status reads require the exact endpoint capabilities', async () => {
    const subscription = sub(`api-test-${genId()}`);
    const registered = await request(
      '/api/subscriptions',
      send('POST', { deviceId: `api-device-${genId()}`, role: 'guest', subscription }),
    );
    const endpoint = (await registered.json()) as {
      endpointId: string;
      managementToken: string;
    };
    const denied = await request(
      '/api/push/tests',
      send('POST', { endpointId: endpoint.endpointId, managementToken: 'wrong' }),
    );
    assert.equal(denied.status, 403);
    const sent = await request('/api/push/tests', send('POST', endpoint));
    assert.equal(sent.status, 200);
    const testResult = (await sent.json()) as { testId: string; statusToken: string };
    assert.equal(
      (
        await request(`/api/push/tests/${testResult.testId}`, {
          headers: { 'x-push-test-token': testResult.statusToken },
        })
      ).status,
      200,
    );
    assert.equal((await request(`/api/push/tests/${testResult.testId}`)).status, 403);
  });
});

afterAll(() => {
  setNotificationMode('shadow', admin.id);
});

describe('notification policy and payload', () => {
  test('uses the promised TTL and urgency for every message kind', () => {
    assert.deepEqual(notificationPolicy('bartender-order'), {
      ttlSeconds: 600,
      urgency: 'high',
      topicScope: 'unique',
    });
    assert.equal(notificationPolicy('guest-making').ttlSeconds, 1_200);
    assert.equal(notificationPolicy('guest-ready').ttlSeconds, 3_600);
    assert.equal(notificationPolicy('staff-request').ttlSeconds, 1_800);
    assert.equal(notificationPolicy('staff-decision').ttlSeconds, 43_200);
    assert.equal(notificationPolicy('device-test').ttlSeconds, 120);
  });

  test('guest making and ready share an opaque bounded topic', () => {
    const making = { ...content(eventA, 'order-1'), kind: 'guest-making' as const };
    const ready = { ...making, kind: 'guest-ready' as const };
    assert.equal(topicFor(making), topicFor(ready));
    assert.ok(topicFor(making).length <= 32);
    assert.doesNotMatch(topicFor(making), /order-1/);
  });

  test('builds a W3C declarative envelope with the service-worker fallback data', () => {
    const payload = declarativePayload(content(eventA), 'delivery-1', 'receipt-secret', 1234);
    assert.equal(payload.web_push, 8030);
    assert.equal(payload.notification.navigate, `/bar/${eventA}`);
    assert.equal(payload.notification.mutable, true);
    assert.equal(payload.notification.data.receiptToken, 'receipt-secret');
    assert.equal(payload.notification.timestamp, 1234);
  });
});

describe('provider retry decisions', () => {
  test('invalidates gone endpoints and never retries permanent request failures', () => {
    assert.equal(classifyPushFailure({ statusCode: 410 }).kind, 'invalidate');
    for (const statusCode of [400, 401, 403, 413]) {
      assert.equal(classifyPushFailure({ statusCode }).kind, 'permanent');
    }
  });

  test('retries network, rate-limit and provider failures', () => {
    assert.equal(classifyPushFailure(new Error('offline')).kind, 'retry');
    assert.equal(classifyPushFailure({ statusCode: 503 }).kind, 'retry');
    assert.deepEqual(
      classifyPushFailure({ statusCode: 429, headers: { 'retry-after': '12' } }, 0),
      { kind: 'retry', code: 'http-429', retryAfterMs: 12_000 },
    );
  });

  test('parses both Retry-After forms and keeps jitter inside ten seconds to five minutes', () => {
    assert.equal(parseRetryAfter('5', 0), 5_000);
    assert.equal(parseRetryAfter(new Date(20_000).toUTCString(), 10_000), 10_000);
    assert.equal(
      retryDelayMs(1, () => 0),
      10_000,
    );
    assert.equal(
      retryDelayMs(20, () => 1),
      300_000,
    );
  });
});

describe('endpoint and outbox durability', () => {
  test('seals raw subscriptions and protects endpoint management with a capability', () => {
    const raw = sub(`sealed-${genId()}`);
    const registration = registerPushEndpoint({
      deviceId: `device-${genId()}`,
      role: 'guest',
      subscription: raw,
      platform: 'android',
      bartender: null,
    });
    const row = orm()
      .select()
      .from(pushEndpoint)
      .where(eq(pushEndpoint.id, registration.endpointId))
      .get()!;
    assert.notEqual(row.endpointHash, raw.endpoint);
    assert.ok(!row.subscriptionCiphertext.includes(raw.endpoint));
    assert.ok(!row.managementTokenHash.includes(registration.managementToken));
  });

  test('snapshots a recipient so a later endpoint refresh cannot redirect queued work', () => {
    const endpoint = sub(`snapshot-${genId()}`, 'old-key');
    const deviceId = `snapshot-device-${genId()}`;
    registerPushEndpoint({
      deviceId,
      role: 'guest',
      subscription: endpoint,
      platform: 'web',
      bartender: null,
    });
    const queued = enqueueNotification(
      { kind: 'device', deviceId },
      { ...content(eventA), kind: 'guest-ready' },
    );
    const deliveryId = queued.deliveryIds[0]!;
    registerPushEndpoint({
      deviceId,
      role: 'guest',
      subscription: sub(endpoint.endpoint.split('/').at(-1)!, 'new-key'),
      platform: 'web',
      bartender: null,
    });
    assert.equal(subscriptionForDelivery(deliveryId)?.keys.p256dh, 'old-key');
  });

  test('selects only active bartenders at the matching party and session', () => {
    const staffA = genId();
    const staffB = genId();
    const sessionA = `session-${genId()}`;
    const sessionB = `session-${genId()}`;
    createStaff({ id: staffA, eventId: eventA, displayName: 'A', status: 'active' });
    createStaff({ id: staffB, eventId: eventB, displayName: 'B', status: 'active' });
    createStaffSession(sessionA, staffA, Date.now() + 60_000);
    createStaffSession(sessionB, staffB, Date.now() + 60_000);
    registerPushEndpoint({
      deviceId: `bar-a-${genId()}`,
      role: 'bartender',
      subscription: sub(`bar-a-${genId()}`),
      platform: 'ios',
      bartender: {
        staff: staffByIdUnscoped(staffA as TrustedStaffId)!,
        expiresAt: Date.now() + 60_000,
        tokenHash: sessionA,
      },
    });
    registerPushEndpoint({
      deviceId: `bar-b-${genId()}`,
      role: 'bartender',
      subscription: sub(`bar-b-${genId()}`),
      platform: 'android',
      bartender: {
        staff: staffByIdUnscoped(staffB as TrustedStaffId)!,
        expiresAt: Date.now() + 60_000,
        tokenHash: sessionB,
      },
    });

    const first = enqueueNotification({ kind: 'bartenders', eventId: eventA }, content(eventA));
    assert.equal(first.deliveryIds.length, 1, 'party B must not receive party A work');
    deleteStaffSession(sessionA);
    const afterLogout = enqueueNotification(
      { kind: 'bartenders', eventId: eventA },
      content(eventA),
    );
    assert.equal(afterLogout.deliveryIds.length, 0, 'explicit logout must invalidate targeting');
    const redacted = orm()
      .select()
      .from(notificationMessage)
      .where(eq(notificationMessage.id, afterLogout.messageId))
      .get()!;
    assert.equal(
      redacted.body,
      null,
      'a no-target payload must not linger until retention cleanup',
    );
  });

  test('records receipts idempotently without turning absence into a failure', () => {
    const deviceId = `receipt-device-${genId()}`;
    registerPushEndpoint({
      deviceId,
      role: 'guest',
      subscription: sub(genId()),
      platform: 'web',
      bartender: null,
    });
    const queued = enqueueNotification(
      { kind: 'device', deviceId },
      { ...content(eventA), kind: 'guest-ready' },
    );
    const deliveryId = queued.deliveryIds[0]!;
    const token = receiptTokenForDelivery(deliveryId);
    const before = orm()
      .select()
      .from(notificationDailyAggregate)
      .where(
        and(
          eq(notificationDailyAggregate.eventId, eventA),
          eq(notificationDailyAggregate.kind, 'guest-ready'),
        ),
      )
      .all()
      .reduce((sum, row) => sum + row.displayed, 0);
    assert.equal(recordReceipt(token, 'displayed'), true);
    assert.equal(recordReceipt(token, 'displayed'), true);
    const after = orm()
      .select()
      .from(notificationDailyAggregate)
      .where(
        and(
          eq(notificationDailyAggregate.eventId, eventA),
          eq(notificationDailyAggregate.kind, 'guest-ready'),
        ),
      )
      .all()
      .reduce((sum, row) => sum + row.displayed, 0);
    assert.equal(after - before, 1);
    assert.equal(deliveryForSend(deliveryId)?.delivery.acceptedAt, null);
  });

  test('rolls business state back when notification creation itself cannot commit', () => {
    const before = listOrders(eventA).length;
    assert.throws(() =>
      dbTransaction(() => {
        createOrder(eventA, {
          name: 'Rollback',
          items: [{ name: 'Mojito', qty: 1 }],
          note: '',
          deviceId: `rollback-${genId()}`,
        });
        enqueueNotification({ kind: 'bartenders', eventId: eventA }, content(eventA));
        throw new Error('force rollback');
      }),
    );
    assert.equal(listOrders(eventA).length, before);
  });

  test('recovers an unfinished delivery after its worker lease expires', () => {
    const deviceId = `lease-device-${genId()}`;
    registerPushEndpoint({
      deviceId,
      role: 'guest',
      subscription: sub(genId()),
      platform: 'web',
      bartender: null,
    });
    const queued = enqueueNotification(
      { kind: 'device', deviceId },
      { ...content(eventA), kind: 'guest-ready' },
    );
    const deliveryId = queued.deliveryIds[0]!;

    try {
      setNotificationMode('live', admin.id);
      assert.ok(claimDeliveries(1_000, 60_000).includes(deliveryId));
      assert.ok(!claimDeliveries(1_000, 60_000).includes(deliveryId));
      orm()
        .update(notificationDelivery)
        .set({ leaseUntil: Date.now() - 1 })
        .where(eq(notificationDelivery.id, deliveryId))
        .run();
      assert.ok(claimDeliveries(1_000, 60_000).includes(deliveryId));
    } finally {
      setNotificationMode('paused', admin.id);
    }
  });

  test('provider acceptance is terminal and redacts the rendered payload', () => {
    const deviceId = `accepted-device-${genId()}`;
    registerPushEndpoint({
      deviceId,
      role: 'guest',
      subscription: sub(genId()),
      platform: 'android',
      bartender: null,
    });
    const queued = enqueueNotification(
      { kind: 'device', deviceId },
      { ...content(eventA), kind: 'guest-ready' },
    );
    const deliveryId = queued.deliveryIds[0]!;

    markDeliveryAccepted(deliveryId, 201);
    const terminal = deliveryForSend(deliveryId)!;
    assert.equal(terminal.delivery.status, 'accepted');
    assert.equal(terminal.delivery.subscriptionCiphertext, null);
    assert.equal(terminal.message.title, null);
    assert.equal(terminal.message.body, null);

    try {
      setNotificationMode('live', admin.id);
      assert.ok(!claimDeliveries(1_000).includes(deliveryId));
    } finally {
      setNotificationMode('paused', admin.id);
    }
  });

  test('expires queued work without reviving it when delivery resumes', () => {
    const deviceId = `expired-device-${genId()}`;
    registerPushEndpoint({
      deviceId,
      role: 'guest',
      subscription: sub(genId()),
      platform: 'ios',
      bartender: null,
    });
    const queued = enqueueNotification(
      { kind: 'device', deviceId },
      { ...content(eventA), kind: 'device-test' },
    );
    const deliveryId = queued.deliveryIds[0]!;
    orm()
      .update(notificationMessage)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(notificationMessage.id, queued.messageId))
      .run();

    assert.ok(expireQueuedDeliveries() >= 1);
    assert.equal(deliveryForSend(deliveryId)?.delivery.status, 'expired');
    try {
      setNotificationMode('live', admin.id);
      assert.ok(!claimDeliveries(1_000).includes(deliveryId));
    } finally {
      setNotificationMode('paused', admin.id);
    }
  });

  test('party deletion cascades scoped audiences and notification history', () => {
    const cascadeEvent = partyFor(admin.id, `Notification cascade ${genId()}`);
    const staffId = genId();
    const sessionId = `session-${genId()}`;
    createStaff({ id: staffId, eventId: cascadeEvent, displayName: 'Cascade', status: 'active' });
    createStaffSession(sessionId, staffId, Date.now() + 60_000);
    registerPushEndpoint({
      deviceId: `cascade-bar-${genId()}`,
      role: 'bartender',
      subscription: sub(genId()),
      platform: 'web',
      bartender: {
        staff: staffByIdUnscoped(staffId as TrustedStaffId)!,
        expiresAt: Date.now() + 60_000,
        tokenHash: sessionId,
      },
    });
    const queued = enqueueNotification(
      { kind: 'bartenders', eventId: cascadeEvent },
      content(cascadeEvent),
    );
    assert.equal(queued.deliveryIds.length, 1);

    deleteEvent(cascadeEvent);
    assert.equal(
      orm().select().from(pushAudience).where(eq(pushAudience.eventId, cascadeEvent)).all().length,
      0,
    );
    assert.equal(
      orm()
        .select()
        .from(notificationMessage)
        .where(eq(notificationMessage.eventId, cascadeEvent))
        .all().length,
      0,
    );
    assert.equal(deliveryForSend(queued.deliveryIds[0]!), undefined);
  });
});

describe('legacy migration', () => {
  test('preserves guests and clears unscoped bartenders idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocktails-push-migration-'));
    const path = join(dir, 'legacy.sqlite');
    const first = createDb(path);
    first.saveSubscription('legacy-guest', 'guest', sub('legacy-guest'));
    first.saveSubscription('legacy-bar', 'bartender', sub('legacy-bar'));
    first.raw.close();

    const migrated = createDb(path);
    const endpoints = migrated.orm.select().from(pushEndpoint).all();
    const audiences = migrated.orm.select().from(pushAudience).all();
    assert.equal(endpoints.length, 1);
    assert.equal(audiences.length, 1);
    assert.equal(audiences[0]?.role, 'guest');
    assert.equal(
      migrated.orm
        .select()
        .from(subscriptions)
        .all()
        .some((row) => row.role === 'bartender'),
      false,
    );
    migrated.raw.close();

    const again = createDb(path);
    assert.equal(again.orm.select().from(pushEndpoint).all().length, 1);
    again.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
