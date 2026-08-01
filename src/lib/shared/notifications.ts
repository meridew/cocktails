import type { Platform, PushSubscriptionJSON, SubscriberRole } from './push';

export type NotificationMode = 'shadow' | 'live' | 'paused';

export const NOTIFICATION_MODES: readonly NotificationMode[] = ['shadow', 'live', 'paused'];

export function isNotificationMode(value: unknown): value is NotificationMode {
  return typeof value === 'string' && NOTIFICATION_MODES.includes(value as NotificationMode);
}

export type NotificationKind =
  | 'bartender-order'
  | 'guest-making'
  | 'guest-ready'
  | 'staff-request'
  | 'staff-decision'
  | 'device-test';

export type NotificationUrgency = 'very-low' | 'low' | 'normal' | 'high';
export type NotificationReceiptStage = 'received' | 'displayed' | 'clicked';

export interface NotificationPolicy {
  ttlSeconds: number;
  urgency: NotificationUrgency;
  /** Stable entity scope used to derive an opaque Web Push Topic. */
  topicScope: 'unique' | 'guest-order' | 'party-staff-request';
}

export interface NotificationContent {
  kind: NotificationKind;
  eventId: string | null;
  entityId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface DeclarativeNotificationPayload {
  web_push: 8030;
  notification: {
    title: string;
    body: string;
    navigate: string;
    tag: string;
    icon: string;
    badge: string;
    timestamp: number;
    renotify: boolean;
    mutable: true;
    data: {
      url: string;
      deliveryId: string;
      receiptToken: string;
    };
  };
}

export interface PushRegistrationRequest {
  deviceId: string;
  role: SubscriberRole;
  subscription: PushSubscriptionJSON;
  platform?: Platform;
}

export interface PushRegistrationResponse {
  ok: true;
  endpointId: string;
  managementToken: string;
  role: SubscriberRole;
  eventId: string | null;
  registeredAt: number;
}

export interface NotificationDeviceStatus {
  registered: boolean;
  platform: Platform | null;
  lastSeenAt: number | null;
  lastAcceptedAt: number | null;
  invalidatedAt: number | null;
}

export interface NotificationTestResponse {
  ok: true;
  testId: string;
  statusToken: string;
  expiresAt: number;
}

export interface NotificationTestStatus {
  ok: true;
  status: 'queued' | 'accepted' | 'received' | 'displayed' | 'clicked' | 'failed' | 'expired';
  providerAcceptedAt: number | null;
  receivedAt: number | null;
  displayedAt: number | null;
  clickedAt: number | null;
  expiresAt: number;
}

export interface NotificationTotals {
  targeted: number;
  noTargets: number;
  accepted: number;
  permanentFailures: number;
  expired: number;
  retries: number;
  received: number;
  displayed: number;
  clicked: number;
  averageAcceptanceMs: number | null;
  averageReceiptMs: number | null;
}

export interface NotificationHealthSummary {
  eventId: string;
  eventName: string;
  hostUserId: string;
  startsAt: number | null;
  status: string;
  mode: NotificationMode;
  endpoints: number;
  oldestQueuedAt: number | null;
  platforms: Record<Platform, number>;
  totals: NotificationTotals;
}

export interface NotificationHealthResponse {
  ok: true;
  mode: NotificationMode;
  parties: NotificationHealthSummary[];
  configuration?: { enabled: boolean; problem: string | null };
}

export interface NotificationDailyHealth {
  day: string;
  platform: Platform;
  kind: NotificationKind;
  totals: NotificationTotals;
}

export interface NotificationPartyHealthResponse {
  ok: true;
  summary: NotificationHealthSummary;
  daily: NotificationDailyHealth[];
}
