import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync(new URL('../src/routes/e/[id]/+page.svelte', import.meta.url), 'utf8');

describe('guest menu refresh triggers', () => {
  test('refreshes when a desktop window regains focus', () => {
    expect(source).toContain("window.addEventListener('focus', onFocus)");
    expect(source).toContain("window.removeEventListener('focus', onFocus)");
  });
});
