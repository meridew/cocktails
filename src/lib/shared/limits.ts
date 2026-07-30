/** Shared bounds, so the client can prevent what the server would reject. */
export const LIMITS = {
  maxOrders: 500,
  maxItemsPerOrder: 50,
  maxFieldLen: 140,
  maxQty: 99,
} as const;
