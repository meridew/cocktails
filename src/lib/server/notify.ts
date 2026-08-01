/**
 * What we say, and when — every notification the app sends, in one place.
 *
 * Kept out of `app.ts` so routing isn't interleaved with wording, and so the copy
 * is directly testable: these are the only sentences a guest ever sees from us, and
 * getting one wrong (telling someone to come and fetch a drink that's being carried
 * to them) is a real failure, not a cosmetic one.
 *
 * Every function here is pure — deciding to send is the caller's job.
 */
import type {
  DeclarativeNotificationPayload,
  NotificationContent,
  NotificationKind,
  NotificationPolicy,
  Order,
} from '$lib/shared';
import { notificationTopic, sha256 } from './notification-security';

const POLICIES: Record<NotificationKind, NotificationPolicy> = {
  'bartender-order': { ttlSeconds: 10 * 60, urgency: 'high', topicScope: 'unique' },
  'guest-making': { ttlSeconds: 20 * 60, urgency: 'high', topicScope: 'guest-order' },
  'guest-ready': { ttlSeconds: 60 * 60, urgency: 'high', topicScope: 'guest-order' },
  'staff-request': {
    ttlSeconds: 30 * 60,
    urgency: 'high',
    topicScope: 'party-staff-request',
  },
  'staff-decision': { ttlSeconds: 12 * 60 * 60, urgency: 'high', topicScope: 'unique' },
  'device-test': { ttlSeconds: 2 * 60, urgency: 'high', topicScope: 'unique' },
};

export function notificationPolicy(kind: NotificationKind): NotificationPolicy {
  return POLICIES[kind];
}

export function topicFor(content: NotificationContent): string {
  const policy = notificationPolicy(content.kind);
  const scope =
    policy.topicScope === 'guest-order'
      ? `guest-order:${content.entityId}`
      : policy.topicScope === 'party-staff-request'
        ? `staff-request:${content.eventId ?? 'none'}`
        : `${content.kind}:${content.entityId}`;
  return notificationTopic(scope);
}

export function entityHash(content: NotificationContent): string {
  return sha256(`${content.kind}\0${content.entityId}`);
}

export function declarativePayload(
  content: Pick<NotificationContent, 'title' | 'body' | 'url' | 'tag'>,
  deliveryId: string,
  receiptToken: string,
  timestamp: number,
): DeclarativeNotificationPayload {
  return {
    web_push: 8030,
    notification: {
      title: content.title,
      body: content.body,
      navigate: content.url,
      tag: content.tag,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      timestamp,
      renotify: Boolean(content.tag),
      mutable: true,
      data: { url: content.url, deliveryId, receiptToken },
    },
  };
}

/**
 * The "it's ready" wording, which must not assume the guest is coming to fetch it.
 *
 * At some parties the bar calls you over; at others a drink is walked to your table.
 * So an unspecified handoff stays deliberately neutral — true either way — and only
 * an explicit choice by the bar commits to one story.
 */
export function readyCopy(order: Order): { title: string; body: string } {
  switch (order.handoff) {
    case 'collect':
      return { title: '🍹 Ready!', body: `${order.name}, your drink is ready at the bar.` };
    case 'deliver':
      return { title: '🍹 On its way!', body: `${order.name}, your drink is coming over to you.` };
    default:
      return { title: '🍹 Ready!', body: `${order.name}, your drink is ready.` };
  }
}

/** Guest "your drink" push for a status change — null for moments we skip. */
export function guestStatusPush(order: Order, eventId: string): NotificationContent | null {
  switch (order.status) {
    case 'making':
      return {
        kind: 'guest-making',
        eventId,
        entityId: order.id,
        title: '👩‍🍳 On it!',
        body: `${order.name}, your order is being made.`,
        tag: order.id,
        url: `/e/${eventId}`,
      };
    case 'serving':
      return {
        kind: 'guest-ready',
        eventId,
        entityId: order.id,
        ...readyCopy(order),
        tag: order.id,
        url: `/e/${eventId}`,
      };
    default:
      return null; // pending/done: no push (done → "how was it?" comes later)
  }
}

/**
 * Tell a helper's device what the host decided about their request.
 *
 * This exists because polling can't be relied on to deliver the answer: a browser
 * throttles and then freezes timers in a backgrounded page, which is exactly where
 * a pocketed phone puts it.
 */
export function staffDecisionPush(
  approved: boolean,
  eventId: string,
  requestId: string,
): NotificationContent {
  return approved
    ? {
        kind: 'staff-decision',
        eventId,
        entityId: requestId,
        title: '✅ You’re in!',
        body: 'The host approved you — the bar is open on this device.',
        tag: `staff-decision-${requestId}`,
        url: `/bar/${eventId}`,
      }
    : {
        kind: 'staff-decision',
        eventId,
        entityId: requestId,
        title: 'Bar access declined',
        body: 'The host didn’t approve this request. You can ask again.',
        tag: `staff-decision-${requestId}`,
        url: `/bar/${eventId}`,
      };
}

/**
 * Tell the bar that somebody wants to help.
 *
 * The host is usually mid-conversation with a drink in hand, not watching a menu
 * for a small dot — so a request that isn't pushed is a request that waits.
 */
export function staffRequestPush(
  name: string,
  eventId: string,
  requestId: string,
): NotificationContent {
  return {
    kind: 'staff-request',
    eventId,
    entityId: requestId,
    title: '🙋 Someone wants to help',
    body: `${name} is asking to work the bar. Approve them in Bar → ⋯ → Bar staff.`,
    tag: `staff-request-${eventId}`,
    url: `/bar/${eventId}`,
  };
}

/** Bartender push when a new order lands. */
export function newOrderPush(order: Order, eventId: string): NotificationContent {
  const summary = order.items.map((i) => `${i.qty}× ${i.name}`).join(', ');
  // Deep-link straight into bartender mode — that's where the bar acts on it.
  return {
    kind: 'bartender-order',
    eventId,
    entityId: order.id,
    title: '🔔 New order',
    body: `${order.name}: ${summary}`,
    tag: order.id,
    url: `/bar/${eventId}`,
  };
}

export function deviceTestPush(entityId: string): NotificationContent {
  return {
    kind: 'device-test',
    eventId: null,
    entityId,
    title: 'Cocktails notification test',
    body: 'This device can receive Cocktails notifications.',
    tag: `device-test-${entityId}`,
    url: '/',
  };
}
