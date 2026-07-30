/**
 * The two production-safety branches in config resolution. These exist so a
 * missing secret can never silently leave a known/guessable value in prod.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { PIN_LENGTH } from '$lib/shared';
import { resolveStaffPassword, resolveStaffPin, resolveAllowedOrigin } from '$lib/server/config';

describe('resolveStaffPassword', () => {
  test('production without STAFF_PASSWORD locks the account behind a random one', () => {
    const pw = resolveStaffPassword({ NODE_ENV: 'production' });
    assert.notEqual(pw, 'cocktails', 'must never fall back to the dev password in production');
    assert.match(pw, /^[0-9a-f]{48}$/, 'expected 24 random bytes as hex');
    // Two calls differ — it is genuinely random, not a fixed placeholder.
    assert.notEqual(pw, resolveStaffPassword({ NODE_ENV: 'production' }));
  });

  test('uses STAFF_PASSWORD when set', () => {
    assert.equal(
      resolveStaffPassword({ NODE_ENV: 'production', STAFF_PASSWORD: 'correct horse' }),
      'correct horse',
    );
  });

  test('dev falls back to the convenience password', () => {
    assert.equal(resolveStaffPassword({}), 'cocktails');
  });
});

describe('resolveStaffPin', () => {
  test('uses STAFF_PIN when set, trimmed', () => {
    assert.equal(resolveStaffPin({ NODE_ENV: 'production', STAFF_PIN: ' 424242 ' }), '424242');
  });

  test('production without a PIN disables the door rather than defaulting to one', () => {
    // A default PIN in production would be a published credential. Empty means the
    // endpoint refuses everything, and email + password remains the way in.
    assert.equal(resolveStaffPin({ NODE_ENV: 'production' }), '');
    assert.equal(resolveStaffPin({ NODE_ENV: 'production', STAFF_PIN: '   ' }), '');
  });

  test('dev falls back to a convenience PIN of the right length', () => {
    assert.equal(resolveStaffPin({}).length, PIN_LENGTH);
  });
});

describe('resolveAllowedOrigin', () => {
  test('production without ALLOWED_ORIGIN allows only the native app origins', () => {
    const origin = resolveAllowedOrigin({ NODE_ENV: 'production' });
    assert.deepEqual(origin, ['capacitor://localhost', 'https://localhost']);
    assert.notEqual(origin, '*', 'must never be wide open in production');
  });

  test('dev is permissive (the Vite proxy is same-origin anyway)', () => {
    assert.equal(resolveAllowedOrigin({}), '*');
  });

  test('parses a comma-separated list, trimming and dropping empties', () => {
    assert.deepEqual(resolveAllowedOrigin({ ALLOWED_ORIGIN: 'a, b ,' }), ['a', 'b']);
    assert.deepEqual(resolveAllowedOrigin({ ALLOWED_ORIGIN: 'https://one.example' }), [
      'https://one.example',
    ]);
  });
});
