/**
 * The two production-safety branches in config resolution. These exist so a
 * missing secret can never silently leave a known/guessable value in prod.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { resolveAdminEmails, resolveAllowedOrigin } from '$lib/server/config';

describe('resolveAdminEmails', () => {
  test('unset means nobody is admin by configuration', () => {
    // Not a lockout: it means the only admins are whatever the database says. The
    // recovery path is to set the variable, which is why it outranks the column.
    assert.deepEqual(resolveAdminEmails({}), []);
  });

  test('splits, trims and lowercases, so a stray space cannot cost you your own app', () => {
    assert.deepEqual(
      resolveAdminEmails({ ADMIN_EMAILS: ' Dan@Example.com , other@example.com ' }),
      ['dan@example.com', 'other@example.com'],
    );
  });

  test('ignores empty entries from a trailing comma', () => {
    assert.deepEqual(resolveAdminEmails({ ADMIN_EMAILS: 'a@b.c,,' }), ['a@b.c']);
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
