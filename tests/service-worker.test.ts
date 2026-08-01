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
