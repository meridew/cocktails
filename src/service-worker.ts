/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
/**
 * Push-only service worker.
 *
 * The app used to precache and intercept every page request. That produced an
 * offline shell which could not do anything without the API, while a failed install
 * or stale worker could hold the whole origin on an old build. Push is the only
 * feature that needs a worker, so page and asset requests now stay with the browser.
 */

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  const ready = (async () => {
    const keys = await caches.keys();
    const legacy = keys.filter((key) => key.startsWith('cocktails-'));
    await Promise.all(legacy.map((key) => caches.delete(key)));
    await self.clients.claim();
    return legacy.length > 0;
  })();
  event.waitUntil(ready);

  /**
   * The first push-only worker is also the one-time escape hatch for old shells.
   *
   * A legacy cache proves this activation replaced a precaching worker. Reload those
   * clients after activation, when requests can reach the network. Later workers find
   * no legacy cache, so ordinary deploys return to the polite UpdateBar prompt.
   */
  void ready.then(async (hadLegacyCache) => {
    if (!hadLegacyCache) return;
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.navigate(client.url).catch(() => {});
    }
  });
});

// ---- Web Push ----

interface LegacyPushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
}

interface ReceiptData {
  url?: string;
  deliveryId?: string;
  receiptToken?: string;
}

interface DeclarativePushPayload {
  web_push?: number;
  notification?: {
    title?: string;
    body?: string;
    navigate?: string;
    tag?: string;
    icon?: string;
    badge?: string;
    timestamp?: number;
    renotify?: boolean;
    data?: ReceiptData;
  };
}

interface StoredRegistration {
  endpointId: string;
  managementToken: string;
  endpoint: string;
  deviceId: string;
  roles: ('guest' | 'bartender')[];
  vapidKey: string;
  pendingRefresh: boolean;
}

const DB_NAME = 'cocktails-push';
const DB_STORE = 'registration';
const DB_KEY = 'current';

function openRegistrationDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readRegistration(): Promise<StoredRegistration | null> {
  const db = await openRegistrationDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(DB_STORE).objectStore(DB_STORE).get(DB_KEY);
    request.onsuccess = () => resolve((request.result as StoredRegistration | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

async function writeRegistration(value: StoredRegistration): Promise<void> {
  const db = await openRegistrationDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(value, DB_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function postReceipt(data: ReceiptData | undefined, stage: string): Promise<void> {
  if (!data?.receiptToken) return;
  await fetch('/api/push/receipts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-push-receipt-token': data.receiptToken,
    },
    body: JSON.stringify({ stage }),
  }).catch(() => {});
}

self.addEventListener('push', (event) => {
  const nativeNotification = (event as unknown as { notification?: Notification }).notification;
  if (nativeNotification) {
    const data = nativeNotification.data as ReceiptData | undefined;
    event.waitUntil(
      Promise.allSettled([postReceipt(data, 'received'), postReceipt(data, 'displayed')]).then(
        () => undefined,
      ),
    );
    return;
  }

  let raw: LegacyPushPayload & DeclarativePushPayload = {};
  try {
    if (event.data) raw = event.data.json() as LegacyPushPayload & DeclarativePushPayload;
  } catch {
    /* non-JSON payload → the defaults below */
  }
  const declarative = raw.notification;
  const data = declarative?.data;
  const title = declarative?.title ?? raw.title ?? '🍸 Cocktails';
  const body = declarative?.body ?? raw.body ?? '';
  const tag = declarative?.tag ?? raw.tag;
  const url = declarative?.navigate ?? data?.url ?? raw.url ?? '/';
  event.waitUntil(
    (async () => {
      const received = postReceipt(data, 'received');
      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: declarative?.renotify ?? Boolean(tag),
        vibrate: [180, 80, 180],
        icon: declarative?.icon ?? '/pwa-192.png',
        badge: declarative?.badge ?? '/pwa-192.png',
        timestamp: declarative?.timestamp,
        data: { ...data, url },
      });
      await Promise.allSettled([received, postReceipt(data, 'displayed')]);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as ReceiptData | null;
  const target = data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const receipt = postReceipt(data ?? undefined, 'clicked');
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        await receipt;
        return;
      }
      await self.clients.openWindow(target);
      await receipt;
    })(),
  );
});

/**
 * Browser subscription rotation can happen while no page is awake. Refresh guest
 * membership here; bartender scope deliberately waits for the next authenticated
 * bar page because a service worker does not retain a staff bearer credential.
 */
self.addEventListener('pushsubscriptionchange', (rawEvent: Event) => {
  const event = rawEvent as Event & {
    waitUntil(promise: Promise<unknown>): void;
    newSubscription?: PushSubscription | null;
  };
  event.waitUntil(
    (async () => {
      const stored = await readRegistration();
      if (!stored) return;
      try {
        const subscription =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(stored.vapidKey),
          }));
        let current = stored;
        for (const role of stored.roles.filter((item) => item === 'guest')) {
          const response = await fetch('/api/subscriptions', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              deviceId: stored.deviceId,
              role,
              subscription: subscription.toJSON(),
              endpointId: current.endpointId,
              managementToken: current.managementToken,
            }),
          });
          if (!response.ok) throw new Error('subscription refresh rejected');
          const next = (await response.json()) as {
            endpointId: string;
            managementToken: string;
          };
          current = {
            ...current,
            endpointId: next.endpointId,
            managementToken: next.managementToken,
            endpoint: subscription.endpoint,
          };
        }
        await writeRegistration({
          ...current,
          endpoint: subscription.endpoint,
          pendingRefresh: stored.roles.includes('bartender'),
        });
      } catch {
        await writeRegistration({ ...stored, pendingRefresh: true });
      }
    })(),
  );
});

export {};
