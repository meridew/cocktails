/** Push subscriptions. One record shape covers Web Push and (later) native tokens. */

export type SubscriberRole = 'guest' | 'bartender';

/** How a push is delivered. Web Push for browsers/PWAs; native tokens for the apps. */
export type SubscriptionTransport = 'webpush' | 'fcm' | 'apns';

/** Where the subscriber is running. */
export type Platform = 'web' | 'ios' | 'android';

/** A W3C PushSubscription as stored server-side. */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SubscriptionRecord {
  deviceId: string;
  role: SubscriberRole;
  /** Web Push subscription today; broadens to a native token payload in the app. */
  subscription: PushSubscriptionJSON;
  transport: SubscriptionTransport;
  platform: Platform;
  createdAt: number;
}
