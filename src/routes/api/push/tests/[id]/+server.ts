import { json, type RequestEvent } from '@sveltejs/kit';
import { cleanStr } from '$lib/shared';
import { fail } from '$lib/server/guards';
import { testStatus } from '$lib/server/notification-store';

/** Read one self-test using its separate, endpoint-local capability. */
export async function GET(event: RequestEvent) {
  const token = cleanStr(event.request.headers.get('x-push-test-token'), 180);
  const status = testStatus(event.params.id!, token);
  if (!status) return fail(403, 'invalid test capability');
  return json(status);
}
