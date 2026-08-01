import { and, asc, count, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type {
  NotificationContent,
  NotificationKind,
  NotificationMode,
  NotificationReceiptStage,
  NotificationTestStatus,
  Platform,
  PushSubscriptionJSON,
  SubscriberRole,
} from '$lib/shared';
import { genId, now, orm, type StaffRow } from './db';
import {
  notificationControl,
  notificationDailyAggregate,
  notificationDelivery,
  notificationMessage,
  pushAudience,
  pushEndpoint,
  staff,
  staffSessions,
} from './schema';
import {
  capabilityMatches,
  endpointHash,
  hashCapability,
  newCapability,
  openSubscription,
  receiptCapability,
  sealSubscription,
} from './notification-security';
import { entityHash, notificationPolicy, topicFor } from './notify';

const ENDPOINT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const DETAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface BartenderAudienceContext {
  staff: StaffRow;
  expiresAt: number;
  tokenHash: string;
}

export interface PushRegistrationResult {
  endpointId: string;
  managementToken: string;
  role: SubscriberRole;
  eventId: string | null;
  registeredAt: number;
}

export type NotificationTarget =
  | { kind: 'bartenders'; eventId: string }
  | { kind: 'device'; deviceId: string }
  | { kind: 'endpoint'; endpointId: string };

export interface EnqueuedNotification {
  messageId: string;
  deliveryIds: string[];
  mode: NotificationMode;
}

type EndpointSnapshot = {
  id: string;
  endpointHash: string;
  subscriptionCiphertext: string;
  platform: string;
};

function normalizedPlatform(value: string): Platform {
  return value === 'ios' || value === 'android' ? value : 'web';
}

export function notificationMode(): NotificationMode {
  const value = orm()
    .select({ mode: notificationControl.mode })
    .from(notificationControl)
    .where(eq(notificationControl.id, 1))
    .get()?.mode;
  return value === 'live' || value === 'paused' ? value : 'shadow';
}

export function setNotificationMode(mode: NotificationMode, updatedBy: string): void {
  orm()
    .insert(notificationControl)
    .values({ id: 1, mode, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: notificationControl.id,
      set: { mode, updatedAt: now(), updatedBy },
    })
    .run();
}

export function registerPushEndpoint(input: {
  deviceId: string;
  role: SubscriberRole;
  subscription: PushSubscriptionJSON;
  platform: Platform;
  bartender: BartenderAudienceContext | null;
}): PushRegistrationResult {
  const db = orm();
  const ts = now();
  const hash = endpointHash(input.subscription.endpoint);
  const managementToken = newCapability();

  db.insert(pushEndpoint)
    .values({
      id: genId(),
      deviceId: input.deviceId,
      endpointHash: hash,
      subscriptionCiphertext: sealSubscription(input.subscription),
      transport: 'webpush',
      platform: input.platform,
      managementTokenHash: hashCapability(managementToken),
      createdAt: ts,
      lastSeenAt: ts,
      invalidatedAt: null,
      consecutiveFailures: 0,
    })
    .onConflictDoUpdate({
      target: pushEndpoint.endpointHash,
      set: {
        deviceId: input.deviceId,
        subscriptionCiphertext: sealSubscription(input.subscription),
        transport: 'webpush',
        platform: input.platform,
        managementTokenHash: hashCapability(managementToken),
        lastSeenAt: ts,
        invalidatedAt: null,
        consecutiveFailures: 0,
      },
    })
    .run();

  const endpoint = db
    .select({ id: pushEndpoint.id })
    .from(pushEndpoint)
    .where(eq(pushEndpoint.endpointHash, hash))
    .get()!;

  const role: SubscriberRole =
    input.role === 'bartender' && input.bartender ? 'bartender' : 'guest';
  if (role === 'bartender') {
    const bartender = input.bartender!;
    // One endpoint may move between bars; stale scopes must not follow it.
    db.delete(pushAudience)
      .where(and(eq(pushAudience.endpointId, endpoint.id), eq(pushAudience.role, 'bartender')))
      .run();
    db.insert(pushAudience)
      .values({
        endpointId: endpoint.id,
        audienceKey: `bartender:${bartender.staff.eventId}:${bartender.staff.id}`,
        role,
        eventId: bartender.staff.eventId,
        staffId: bartender.staff.id,
        sessionTokenHash: bartender.tokenHash,
        expiresAt: bartender.expiresAt,
        createdAt: ts,
        lastSeenAt: ts,
      })
      .run();
  } else {
    db.insert(pushAudience)
      .values({
        endpointId: endpoint.id,
        audienceKey: 'guest',
        role,
        eventId: null,
        staffId: null,
        sessionTokenHash: null,
        expiresAt: null,
        createdAt: ts,
        lastSeenAt: ts,
      })
      .onConflictDoUpdate({
        target: [pushAudience.endpointId, pushAudience.audienceKey],
        set: { lastSeenAt: ts },
      })
      .run();
  }

  return {
    endpointId: endpoint.id,
    managementToken,
    role,
    eventId: role === 'bartender' ? input.bartender!.staff.eventId : null,
    registeredAt: ts,
  };
}

export function endpointForManagement(
  endpointId: string,
  managementToken: string,
): typeof pushEndpoint.$inferSelect | null {
  const row = orm().select().from(pushEndpoint).where(eq(pushEndpoint.id, endpointId)).get();
  if (!row || !capabilityMatches(managementToken, row.managementTokenHash)) return null;
  return row;
}

export function refreshManagedEndpoint(endpointId: string, managementToken: string): boolean {
  if (!endpointForManagement(endpointId, managementToken)) return false;
  orm()
    .update(pushEndpoint)
    .set({ lastSeenAt: now() })
    .where(eq(pushEndpoint.id, endpointId))
    .run();
  return true;
}

export function deleteManagedEndpoint(endpointId: string, managementToken: string): boolean {
  if (!endpointForManagement(endpointId, managementToken)) return false;
  return orm().delete(pushEndpoint).where(eq(pushEndpoint.id, endpointId)).run().changes > 0;
}

function recipients(target: NotificationTarget, ts: number): EndpointSnapshot[] {
  const db = orm();
  if (target.kind === 'endpoint') {
    return db
      .select({
        id: pushEndpoint.id,
        endpointHash: pushEndpoint.endpointHash,
        subscriptionCiphertext: pushEndpoint.subscriptionCiphertext,
        platform: pushEndpoint.platform,
      })
      .from(pushEndpoint)
      .where(and(eq(pushEndpoint.id, target.endpointId), isNull(pushEndpoint.invalidatedAt)))
      .all();
  }

  if (target.kind === 'device') {
    return db
      .selectDistinct({
        id: pushEndpoint.id,
        endpointHash: pushEndpoint.endpointHash,
        subscriptionCiphertext: pushEndpoint.subscriptionCiphertext,
        platform: pushEndpoint.platform,
      })
      .from(pushEndpoint)
      .innerJoin(pushAudience, eq(pushAudience.endpointId, pushEndpoint.id))
      .where(
        and(
          eq(pushEndpoint.deviceId, target.deviceId),
          eq(pushAudience.role, 'guest'),
          isNull(pushEndpoint.invalidatedAt),
        ),
      )
      .all();
  }

  return db
    .selectDistinct({
      id: pushEndpoint.id,
      endpointHash: pushEndpoint.endpointHash,
      subscriptionCiphertext: pushEndpoint.subscriptionCiphertext,
      platform: pushEndpoint.platform,
    })
    .from(pushEndpoint)
    .innerJoin(pushAudience, eq(pushAudience.endpointId, pushEndpoint.id))
    .innerJoin(staff, eq(staff.id, pushAudience.staffId))
    .innerJoin(staffSessions, eq(staffSessions.tokenHash, pushAudience.sessionTokenHash))
    .where(
      and(
        eq(pushAudience.role, 'bartender'),
        eq(pushAudience.eventId, target.eventId),
        eq(staff.eventId, target.eventId),
        eq(staff.status, 'active'),
        gt(pushAudience.expiresAt, ts),
        gt(staffSessions.expiresAt, ts),
        isNull(pushEndpoint.invalidatedAt),
      ),
    )
    .all();
}

export function enqueueNotification(
  target: NotificationTarget,
  content: NotificationContent,
): EnqueuedNotification {
  const db = orm();
  const ts = now();
  const mode = notificationMode();
  const policy = notificationPolicy(content.kind);
  const messageId = genId();
  const selected = recipients(target, ts);

  db.insert(notificationMessage)
    .values({
      id: messageId,
      eventId: content.eventId,
      kind: content.kind,
      entityHash: entityHash(content),
      title: content.title,
      body: content.body,
      url: content.url,
      tag: content.tag,
      topic: topicFor(content),
      ttlSeconds: policy.ttlSeconds,
      urgency: policy.urgency,
      createdAt: ts,
      expiresAt: ts + policy.ttlSeconds * 1000,
    })
    .run();

  const deliveryIds: string[] = [];
  for (const endpoint of selected) {
    const id = genId();
    const receiptToken = receiptCapability(id);
    db.insert(notificationDelivery)
      .values({
        id,
        messageId,
        endpointId: endpoint.id,
        endpointHash: endpoint.endpointHash,
        subscriptionCiphertext: endpoint.subscriptionCiphertext,
        platform: normalizedPlatform(endpoint.platform),
        deliveryMode: mode,
        status: mode === 'shadow' ? 'shadow_pending' : 'pending',
        receiptTokenHash: hashCapability(receiptToken),
        attempts: 0,
        nextAttemptAt: ts,
        createdAt: ts,
      })
      .run();
    deliveryIds.push(id);
    incrementAggregate(
      content.eventId,
      content.kind,
      normalizedPlatform(endpoint.platform),
      'targeted',
    );
  }

  if (selected.length === 0) {
    incrementAggregate(content.eventId, content.kind, 'web', 'noTargets');
    redactIfTerminal(messageId);
  }

  return { messageId, deliveryIds, mode };
}

export function deliveryForSend(deliveryId: string) {
  return orm()
    .select({ delivery: notificationDelivery, message: notificationMessage })
    .from(notificationDelivery)
    .innerJoin(notificationMessage, eq(notificationMessage.id, notificationDelivery.messageId))
    .where(eq(notificationDelivery.id, deliveryId))
    .get();
}

export function deliveriesForShadow(messageId: string): string[] {
  return orm()
    .select({ id: notificationDelivery.id })
    .from(notificationDelivery)
    .where(
      and(
        eq(notificationDelivery.messageId, messageId),
        eq(notificationDelivery.status, 'shadow_pending'),
      ),
    )
    .all()
    .map((row) => row.id);
}

export function claimDeliveries(limit = 20, leaseMs = 60_000): string[] {
  if (notificationMode() !== 'live') return [];
  const db = orm();
  const ts = now();
  const ids = db
    .select({ id: notificationDelivery.id })
    .from(notificationDelivery)
    .innerJoin(notificationMessage, eq(notificationMessage.id, notificationDelivery.messageId))
    .where(
      and(
        lte(notificationDelivery.nextAttemptAt, ts),
        gt(notificationMessage.expiresAt, ts),
        or(
          eq(notificationDelivery.status, 'pending'),
          and(eq(notificationDelivery.status, 'leased'), lte(notificationDelivery.leaseUntil, ts)),
        ),
      ),
    )
    .orderBy(asc(notificationDelivery.nextAttemptAt))
    .limit(limit)
    .all()
    .map((row) => row.id);
  if (ids.length === 0) return [];
  db.update(notificationDelivery)
    .set({ status: 'leased', leaseUntil: ts + leaseMs })
    .where(inArray(notificationDelivery.id, ids))
    .run();
  return ids;
}

export function startDeliveryAttempt(deliveryId: string): void {
  const ts = now();
  orm()
    .update(notificationDelivery)
    .set({
      attempts: sql`${notificationDelivery.attempts} + 1`,
      firstAttemptAt: sql`COALESCE(${notificationDelivery.firstAttemptAt}, ${ts})`,
      leaseUntil: ts + 60_000,
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .run();
}

export function markDeliveryAccepted(deliveryId: string, providerStatus = 201): void {
  const db = orm();
  const row = deliveryForSend(deliveryId);
  if (!row || row.delivery.acceptedAt) return;
  const ts = now();
  db.update(notificationDelivery)
    .set({
      status: 'accepted',
      providerStatus,
      acceptedAt: ts,
      terminalAt: ts,
      leaseUntil: null,
      subscriptionCiphertext: null,
      failureCode: null,
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .run();
  if (row.delivery.endpointId) {
    db.update(pushEndpoint)
      .set({ lastAcceptedAt: ts, consecutiveFailures: 0 })
      .where(eq(pushEndpoint.id, row.delivery.endpointId))
      .run();
  }
  incrementAggregate(
    row.message.eventId,
    row.message.kind as NotificationKind,
    normalizedPlatform(row.delivery.platform),
    'accepted',
    Math.max(0, ts - row.message.createdAt),
  );
  redactIfTerminal(row.message.id);
}

export function rescheduleDelivery(
  deliveryId: string,
  nextAttemptAt: number,
  providerStatus: number | null,
  failureCode: string,
): void {
  const row = deliveryForSend(deliveryId);
  if (!row) return;
  orm()
    .update(notificationDelivery)
    .set({
      status: 'pending',
      nextAttemptAt,
      providerStatus,
      failureCode,
      leaseUntil: null,
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .run();
  incrementAggregate(
    row.message.eventId,
    row.message.kind as NotificationKind,
    normalizedPlatform(row.delivery.platform),
    'retries',
  );
}

export function markDeliveryTerminal(
  deliveryId: string,
  status: 'permanent_failure' | 'expired',
  providerStatus: number | null,
  failureCode: string,
  invalidateEndpoint = false,
): void {
  const db = orm();
  const row = deliveryForSend(deliveryId);
  if (!row || row.delivery.terminalAt) return;
  const ts = now();
  db.update(notificationDelivery)
    .set({
      status,
      providerStatus,
      failureCode,
      terminalAt: ts,
      leaseUntil: null,
      subscriptionCiphertext: null,
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .run();
  if (row.delivery.endpointId) {
    db.update(pushEndpoint)
      .set({
        lastFailureAt: ts,
        consecutiveFailures: sql`${pushEndpoint.consecutiveFailures} + 1`,
      })
      .where(eq(pushEndpoint.id, row.delivery.endpointId))
      .run();
    if (invalidateEndpoint) {
      db.delete(pushEndpoint).where(eq(pushEndpoint.id, row.delivery.endpointId)).run();
    }
  }
  incrementAggregate(
    row.message.eventId,
    row.message.kind as NotificationKind,
    normalizedPlatform(row.delivery.platform),
    status === 'expired' ? 'expired' : 'permanentFailures',
  );
  redactIfTerminal(row.message.id);
}

export function expireQueuedDeliveries(): number {
  const db = orm();
  const ts = now();
  const rows = db
    .select({ id: notificationDelivery.id })
    .from(notificationDelivery)
    .innerJoin(notificationMessage, eq(notificationMessage.id, notificationDelivery.messageId))
    .where(
      and(
        inArray(notificationDelivery.status, ['pending', 'leased', 'shadow_pending']),
        lte(notificationMessage.expiresAt, ts),
      ),
    )
    .all();
  for (const row of rows) markDeliveryTerminal(row.id, 'expired', null, 'expired');
  return rows.length;
}

export function recordReceipt(token: string, stage: NotificationReceiptStage): boolean {
  const db = orm();
  const hash = hashCapability(token);
  const row = db
    .select({ delivery: notificationDelivery, message: notificationMessage })
    .from(notificationDelivery)
    .innerJoin(notificationMessage, eq(notificationMessage.id, notificationDelivery.messageId))
    .where(eq(notificationDelivery.receiptTokenHash, hash))
    .get();
  if (!row) return false;
  const column =
    stage === 'received'
      ? row.delivery.receivedAt
      : stage === 'displayed'
        ? row.delivery.displayedAt
        : row.delivery.clickedAt;
  if (column) return true;
  const ts = now();
  db.update(notificationDelivery)
    .set(
      stage === 'received'
        ? { receivedAt: ts }
        : stage === 'displayed'
          ? { displayedAt: ts }
          : { clickedAt: ts },
    )
    .where(eq(notificationDelivery.id, row.delivery.id))
    .run();
  incrementAggregate(
    row.message.eventId,
    row.message.kind as NotificationKind,
    normalizedPlatform(row.delivery.platform),
    stage,
    stage === 'received' ? Math.max(0, ts - row.message.createdAt) : 0,
  );
  return true;
}

export function testStatus(deliveryId: string, token: string): NotificationTestStatus | null {
  const row = deliveryForSend(deliveryId);
  if (!row || !capabilityMatches(token, row.delivery.receiptTokenHash)) return null;
  let status: NotificationTestStatus['status'] = 'queued';
  if (row.delivery.clickedAt) status = 'clicked';
  else if (row.delivery.displayedAt) status = 'displayed';
  else if (row.delivery.receivedAt) status = 'received';
  else if (row.delivery.acceptedAt) status = 'accepted';
  else if (row.delivery.status === 'expired') status = 'expired';
  else if (row.delivery.terminalAt) status = 'failed';
  return {
    ok: true,
    status,
    providerAcceptedAt: row.delivery.acceptedAt,
    receivedAt: row.delivery.receivedAt,
    displayedAt: row.delivery.displayedAt,
    clickedAt: row.delivery.clickedAt,
    expiresAt: row.message.expiresAt,
  };
}

export function receiptTokenForDelivery(deliveryId: string): string {
  return receiptCapability(deliveryId);
}

export function subscriptionForDelivery(deliveryId: string): PushSubscriptionJSON | null {
  const ciphertext = deliveryForSend(deliveryId)?.delivery.subscriptionCiphertext;
  return ciphertext ? openSubscription(ciphertext) : null;
}

export function pruneNotificationData(): void {
  const db = orm();
  const ts = now();
  db.delete(pushEndpoint)
    .where(
      or(
        lt(pushEndpoint.lastSeenAt, ts - ENDPOINT_MAX_AGE_MS),
        lte(pushEndpoint.invalidatedAt, ts),
      ),
    )
    .run();
  const oldMessages = db
    .select({ id: notificationMessage.id })
    .from(notificationMessage)
    .where(lt(notificationMessage.createdAt, ts - DETAIL_RETENTION_MS))
    .all()
    .map((row) => row.id);
  if (oldMessages.length > 0) {
    db.delete(notificationMessage).where(inArray(notificationMessage.id, oldMessages)).run();
  }
}

function redactIfTerminal(messageId: string): void {
  const db = orm();
  const unfinished = db
    .select({ n: count() })
    .from(notificationDelivery)
    .where(
      and(
        eq(notificationDelivery.messageId, messageId),
        inArray(notificationDelivery.status, ['pending', 'leased', 'shadow_pending']),
      ),
    )
    .get()?.n;
  if (unfinished) return;
  const ts = now();
  db.update(notificationMessage)
    .set({ title: null, body: null, redactedAt: ts })
    .where(and(eq(notificationMessage.id, messageId), isNull(notificationMessage.redactedAt)))
    .run();
  db.update(notificationDelivery)
    .set({ subscriptionCiphertext: null })
    .where(eq(notificationDelivery.messageId, messageId))
    .run();
}

type AggregateField =
  | 'targeted'
  | 'noTargets'
  | 'accepted'
  | 'permanentFailures'
  | 'expired'
  | 'retries'
  | 'received'
  | 'displayed'
  | 'clicked';

function incrementAggregate(
  eventId: string | null,
  kind: NotificationKind,
  platform: Platform,
  field: AggregateField,
  latencyMs = 0,
): void {
  if (!eventId) return;
  const day = new Date(now()).toISOString().slice(0, 10);
  const base = {
    eventId,
    day,
    platform,
    kind,
    targeted: 0,
    noTargets: 0,
    accepted: 0,
    permanentFailures: 0,
    expired: 0,
    retries: 0,
    received: 0,
    displayed: 0,
    clicked: 0,
    acceptanceLatencyMs: 0,
    receiptLatencyMs: 0,
    [field]: 1,
    ...(field === 'accepted' ? { acceptanceLatencyMs: latencyMs } : {}),
    ...(field === 'received' ? { receiptLatencyMs: latencyMs } : {}),
  };
  const column = notificationDailyAggregate[field];
  orm()
    .insert(notificationDailyAggregate)
    .values(base)
    .onConflictDoUpdate({
      target: [
        notificationDailyAggregate.eventId,
        notificationDailyAggregate.day,
        notificationDailyAggregate.platform,
        notificationDailyAggregate.kind,
      ],
      set: {
        [field]: sql`${column} + 1`,
        ...(field === 'accepted'
          ? {
              acceptanceLatencyMs: sql`${notificationDailyAggregate.acceptanceLatencyMs} + ${latencyMs}`,
            }
          : {}),
        ...(field === 'received'
          ? { receiptLatencyMs: sql`${notificationDailyAggregate.receiptLatencyMs} + ${latencyMs}` }
          : {}),
      },
    })
    .run();
}
