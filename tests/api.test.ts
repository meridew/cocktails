import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  admitOrderGuest,
  bumpOrder,
  clearOrders,
  deleteOrder,
  setItemProgress,
  setStatus,
} from '$lib/api';

describe('party-scoped order mutations', () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({
      ok: true,
      blocked: false,
      order: { id: 'order-1' },
    }),
  );

  beforeEach(() => {
    fetch.mockClear();
    vi.stubGlobal('fetch', fetch);
  });

  test('every mutation names the party for a tokenless account holder', async () => {
    const eventId = 'party / one';

    await setStatus('order-1', eventId, 'making');
    await deleteOrder('order-1', eventId);
    await clearOrders(eventId, 'done');
    await bumpOrder('order-1', eventId, true);
    await admitOrderGuest('order-1', eventId, false);
    await setItemProgress('order-1', eventId, 0, 1);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/orders/order-1?eventId=party%20%2F%20one',
      '/api/orders/order-1?eventId=party%20%2F%20one',
      '/api/orders/clear?eventId=party%20%2F%20one',
      '/api/orders/order-1/bump?eventId=party%20%2F%20one',
      '/api/orders/order-1/admit?eventId=party%20%2F%20one',
      '/api/orders/order-1/progress?eventId=party%20%2F%20one',
    ]);
  });
});
