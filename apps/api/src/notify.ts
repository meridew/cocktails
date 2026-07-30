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
import type { Order } from '@cocktails/shared';
import type { PushPayload } from './push.ts';

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
export function guestStatusPush(order: Order): PushPayload | null {
  switch (order.status) {
    case 'making':
      return {
        title: '👩‍🍳 On it!',
        body: `${order.name}, your order is being made.`,
        tag: order.id,
        url: '/',
      };
    case 'serving':
      return { ...readyCopy(order), tag: order.id, url: '/' };
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
export function staffDecisionPush(approved: boolean): PushPayload {
  return approved
    ? {
        title: '✅ You’re in!',
        body: 'The host approved you — the bar is open on this device.',
        tag: 'staff-decision',
        url: '/?bartender',
      }
    : {
        title: 'Bar access declined',
        body: 'The host didn’t approve this request. You can ask again.',
        tag: 'staff-decision',
        url: '/?bartender',
      };
}

/**
 * Tell the bar that somebody wants to help.
 *
 * The host is usually mid-conversation with a drink in hand, not watching a menu
 * for a small dot — so a request that isn't pushed is a request that waits.
 */
export function staffRequestPush(name: string): PushPayload {
  return {
    title: '🙋 Someone wants to help',
    body: `${name} is asking to work the bar. Approve them in Bar → ⋯ → Bar staff.`,
    tag: 'staff-request',
    url: '/?bartender',
  };
}

/** Bartender push when a new order lands. */
export function newOrderPush(order: Order): PushPayload {
  const summary = order.items.map((i) => `${i.qty}× ${i.name}`).join(', ');
  // Deep-link straight into bartender mode — that's where the bar acts on it.
  return {
    title: '🔔 New order',
    body: `${order.name}: ${summary}`,
    tag: order.id,
    url: '/?bartender',
  };
}
