import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync(new URL('../src/service-worker.ts', import.meta.url), 'utf8');

describe('service worker update safety', () => {
  test('does not intercept page requests or build an offline shell', () => {
    expect(source).not.toContain("addEventListener('fetch'");
    expect(source).not.toContain("from '$service-worker'");
  });

  test('evacuates legacy cached clients once while removing their caches', () => {
    expect(source).toContain("startsWith('cocktails-')");
    expect(source).toContain('client.navigate(client.url)');
  });
});

describe('push alert resilience', () => {
  test('alerts again when a later state replaces the same order notification', () => {
    expect(source).toContain('renotify: declarative?.renotify ?? Boolean(tag)');
  });

  test('asks supporting phones for a short vibration without forcing silence', () => {
    expect(source).toContain('vibrate: [180, 80, 180]');
    expect(source).not.toContain('silent: true');
  });

  test('parses declarative payloads while retaining the legacy fallback', () => {
    expect(source).toContain('raw.notification');
    expect(source).toContain("raw.title ?? '🍸 Cocktails'");
    expect(source).toContain("postReceipt(data, 'displayed')");
  });

  test('repairs guest subscription rotation and defers authenticated bartender scope', () => {
    expect(source).toContain("addEventListener('pushsubscriptionchange'");
    expect(source).toContain("stored.roles.filter((item) => item === 'guest')");
    expect(source).toContain("pendingRefresh: stored.roles.includes('bartender')");
  });
});
