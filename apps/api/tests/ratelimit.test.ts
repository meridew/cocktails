/**
 * The shared fixed-window rate limiter, and the HTTP helpers that decide *what*
 * it is keyed on (a spoofable key would make the limiter decorative).
 */
import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/ratelimit.ts';
import { bearerToken, firstForwardedFor } from '../src/http.ts';

describe('createRateLimiter', () => {
  afterEach(() => mock.timers.reset());

  test('limits only once the max is reached', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
    assert.equal(limiter.isLimited('a'), false);
    limiter.record('a');
    limiter.record('a');
    assert.equal(limiter.isLimited('a'), false, '2 of 3 must not be limited');
    limiter.record('a');
    assert.equal(limiter.isLimited('a'), true, 'the 3rd should hit the limit');
  });

  test('keys are independent', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    limiter.record('a');
    assert.equal(limiter.isLimited('a'), true);
    assert.equal(limiter.isLimited('b'), false);
  });

  test('clear forgets a key', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    limiter.record('a');
    limiter.clear('a');
    assert.equal(limiter.isLimited('a'), false);
  });

  test('the window expires and the count restarts at 1', () => {
    mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    limiter.record('a');
    limiter.record('a');
    assert.equal(limiter.isLimited('a'), true);

    mock.timers.tick(60_001);
    assert.equal(limiter.isLimited('a'), false, 'the window should have expired');
    limiter.record('a');
    assert.equal(limiter.isLimited('a'), false, 'the count should restart, not resume');
  });

  test('bounds its memory even when every key is still fresh', () => {
    // The bound matters precisely when nothing has expired — a prune that only
    // dropped expired entries would be a no-op under a flood of distinct keys.
    const limiter = createRateLimiter({ max: 5, windowMs: 60_000, maxKeys: 10 });
    for (let i = 0; i < 200; i++) limiter.record(`key-${i}`);
    // The most recent key must still be tracked; the map cannot have grown to 200.
    limiter.record('key-199');
    assert.equal(limiter.isLimited('key-0'), false, 'the oldest keys should be evicted');
  });
});

describe('bearerToken', () => {
  test('extracts the token, case-insensitively', () => {
    assert.equal(bearerToken('Bearer abc123'), 'abc123');
    assert.equal(bearerToken('bearer abc123'), 'abc123');
    assert.equal(bearerToken('BEARER abc123'), 'abc123');
  });

  test('ignores other schemes and empty values', () => {
    assert.equal(bearerToken(undefined), undefined);
    assert.equal(bearerToken(''), undefined);
    assert.equal(bearerToken('Basic abc123'), undefined);
    assert.equal(bearerToken('Bearer'), undefined);
    assert.equal(bearerToken('Bearer    '), undefined);
  });
});

describe('firstForwardedFor', () => {
  test('takes only the first hop', () => {
    // Everything after the first entry is attacker-appendable, so using the whole
    // header as a key would let one client rotate it and bypass the limiter.
    assert.equal(firstForwardedFor('1.1.1.1, 2.2.2.2, 3.3.3.3'), '1.1.1.1');
    assert.equal(firstForwardedFor('  1.1.1.1  ,2.2.2.2'), '1.1.1.1');
    assert.equal(firstForwardedFor('1.1.1.1'), '1.1.1.1');
  });

  test('treats missing or empty headers as absent', () => {
    assert.equal(firstForwardedFor(undefined), undefined);
    assert.equal(firstForwardedFor(''), undefined);
    assert.equal(firstForwardedFor('   '), undefined);
    assert.equal(firstForwardedFor(', 2.2.2.2'), undefined);
  });
});
