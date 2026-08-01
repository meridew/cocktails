import { and, asc, countDistinct, eq, inArray } from 'drizzle-orm';
import type {
  NotificationDailyHealth,
  NotificationHealthSummary,
  NotificationKind,
  NotificationTotals,
  Platform,
} from '$lib/shared';
import { orm, type EventRow } from './db';
import { notificationDailyAggregate, notificationDelivery, notificationMessage } from './schema';
import { notificationMode } from './notification-store';

const zeroTotals = (): NotificationTotals => ({
  targeted: 0,
  noTargets: 0,
  accepted: 0,
  permanentFailures: 0,
  expired: 0,
  retries: 0,
  received: 0,
  displayed: 0,
  clicked: 0,
  averageAcceptanceMs: null,
  averageReceiptMs: null,
});

function totalsFrom(rows: (typeof notificationDailyAggregate.$inferSelect)[]): NotificationTotals {
  const totals = zeroTotals();
  let acceptanceLatencyMs = 0;
  let receiptLatencyMs = 0;
  for (const row of rows) {
    totals.targeted += row.targeted;
    totals.noTargets += row.noTargets;
    totals.accepted += row.accepted;
    totals.permanentFailures += row.permanentFailures;
    totals.expired += row.expired;
    totals.retries += row.retries;
    totals.received += row.received;
    totals.displayed += row.displayed;
    totals.clicked += row.clicked;
    acceptanceLatencyMs += row.acceptanceLatencyMs;
    receiptLatencyMs += row.receiptLatencyMs;
  }
  totals.averageAcceptanceMs = totals.accepted ? acceptanceLatencyMs / totals.accepted : null;
  totals.averageReceiptMs = totals.received ? receiptLatencyMs / totals.received : null;
  return totals;
}

export function notificationHealthSummary(party: EventRow): NotificationHealthSummary {
  const db = orm();
  const rows = db
    .select()
    .from(notificationDailyAggregate)
    .where(eq(notificationDailyAggregate.eventId, party.id))
    .all();
  const platforms: Record<Platform, number> = { web: 0, ios: 0, android: 0 };
  for (const row of rows) {
    const platform: Platform =
      row.platform === 'ios' || row.platform === 'android' ? row.platform : 'web';
    platforms[platform] += row.targeted;
  }
  const endpoints =
    db
      .select({ n: countDistinct(notificationDelivery.endpointHash) })
      .from(notificationDelivery)
      .innerJoin(notificationMessage, eq(notificationMessage.id, notificationDelivery.messageId))
      .where(eq(notificationMessage.eventId, party.id))
      .get()?.n ?? 0;
  const oldestQueuedAt =
    db
      .select({ createdAt: notificationMessage.createdAt })
      .from(notificationDelivery)
      .innerJoin(notificationMessage, eq(notificationMessage.id, notificationDelivery.messageId))
      .where(
        and(
          eq(notificationMessage.eventId, party.id),
          inArray(notificationDelivery.status, ['pending', 'leased']),
        ),
      )
      .orderBy(asc(notificationMessage.createdAt))
      .limit(1)
      .get()?.createdAt ?? null;
  return {
    eventId: party.id,
    eventName: party.name,
    hostUserId: party.hostUserId,
    startsAt: party.startsAt,
    status: party.status,
    mode: notificationMode(),
    endpoints,
    oldestQueuedAt,
    platforms,
    totals: totalsFrom(rows),
  };
}

export function notificationDailyHealth(eventId: string): NotificationDailyHealth[] {
  return orm()
    .select()
    .from(notificationDailyAggregate)
    .where(eq(notificationDailyAggregate.eventId, eventId))
    .orderBy(asc(notificationDailyAggregate.day))
    .all()
    .map((row) => ({
      day: row.day,
      platform:
        row.platform === 'ios' || row.platform === 'android' ? row.platform : ('web' as Platform),
      kind: row.kind as NotificationKind,
      totals: totalsFrom([row]),
    }));
}
