import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr, type NotificationReceiptStage } from '$lib/shared';
import { body, fail } from '$lib/server/guards';
import { recordReceipt } from '$lib/server/notification-store';

const STAGES: readonly NotificationReceiptStage[] = ['received', 'displayed', 'clicked'];

/** Idempotent client receipt, authorised by the capability embedded in one push. */
export async function POST(event: RequestEvent) {
  const token = cleanStr(event.request.headers.get('x-push-receipt-token'), 180);
  const b = await body(event);
  const stage = b.stage as NotificationReceiptStage;
  if (!token || !STAGES.includes(stage)) return fail(422, 'invalid receipt');
  if (!recordReceipt(token, stage)) return fail(403, 'invalid receipt capability');
  return json({ ok: true });
}
