/**
 * The push-endpoint allow-list. A subscription endpoint arrives from an
 * unauthenticated client and is later used as a request target by this server, so
 * accepting an arbitrary URL would make the API a blind SSRF proxy into the NAS
 * network. Delivery itself is not tested (that would hit real push services).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedPushEndpoint, pushEnabled, vapidPublicKey } from '../src/push.ts';

describe('isAllowedPushEndpoint', () => {
  test('accepts the real push services', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://android.googleapis.com/gcm/send/abc123',
      'https://updates.push.services.mozilla.com/wpush/v2/abc123',
      'https://web.push.apple.com/abc123',
      'https://xyz.notify.windows.com/w/?token=abc',
    ]) {
      assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
    }
  });

  test('rejects internal and non-push targets (the SSRF cases)', () => {
    for (const endpoint of [
      'https://192.168.1.1/admin/reboot',
      'https://127.0.0.1:8787/api/orders/clear',
      'https://localhost/api/health',
      'https://attacker.example/collect',
      'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.attacker.example/x',
    ]) {
      assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
    }
  });

  test('requires https', () => {
    assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
    assert.equal(isAllowedPushEndpoint('file:///etc/passwd'), false);
    assert.equal(isAllowedPushEndpoint('gopher://fcm.googleapis.com/'), false);
  });

  test('rejects unparseable input rather than throwing', () => {
    for (const endpoint of ['', 'not a url', '://', 'javascript:alert(1)']) {
      assert.doesNotThrow(() => isAllowedPushEndpoint(endpoint));
      assert.equal(isAllowedPushEndpoint(endpoint), false, JSON.stringify(endpoint));
    }
  });
});

describe('push configuration', () => {
  test('is disabled without VAPID keys, so tests never reach the network', () => {
    assert.equal(pushEnabled(), false);
    assert.equal(vapidPublicKey(), '');
  });
});
