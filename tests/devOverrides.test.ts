/**
 * Dev-only capability overrides.
 *
 * Two things are being asserted, and the second matters more than the first:
 *
 *   1. that they work — a desktop browser can pretend to be an iPhone that hasn't
 *      installed the app, or one that has never been asked about notifications;
 *   2. that they are **inert in a production build**. A shipped `?permission=granted`
 *      would let any URL lie to the app about a browser permission, which is a real
 *      bug rather than stray dev convenience.
 */
import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { parseOverrides } from '$lib/devOverrides';

/** Import a fresh copy with `location.search` set and DEV forced either way. */
async function withUrl(search: string, dev = true) {
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  const url = new URL(`http://localhost/${search}`);
  vi.stubGlobal('location', { search: url.search, href: url.href });
  const mod = await import('$lib/devOverrides');
  mod.clearOverridesCache();
  return mod;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

describe('parsing', () => {
  test('reads each capability', () => {
    assert.deepEqual(parseOverrides('?permission=denied'), { permission: 'denied' });
    assert.deepEqual(parseOverrides('?platform=ios'), { platform: 'ios' });
    assert.deepEqual(parseOverrides('?installed=1'), { installed: true });
    assert.deepEqual(parseOverrides('?installed=0'), { installed: false });
    assert.deepEqual(parseOverrides('?push=unsupported'), { push: 'unsupported' });
  });

  test('combines them', () => {
    assert.deepEqual(parseOverrides('?platform=ios&installed=0&push=unsupported'), {
      platform: 'ios',
      installed: false,
      push: 'unsupported',
    });
  });

  test('ignores anything unrecognised rather than trusting it', () => {
    // A typo must not become a state the app can't otherwise reach.
    assert.deepEqual(parseOverrides('?permission=maybe'), {});
    assert.deepEqual(parseOverrides('?platform=windows-phone'), {});
    assert.deepEqual(parseOverrides('?installed=yes'), {});
    assert.deepEqual(parseOverrides(''), {});
  });
});

describe('in dev', () => {
  test('a query param takes effect', async () => {
    const { overrides } = await withUrl('?permission=granted');
    assert.equal(overrides().permission, 'granted');
  });

  test('sticks across a reload, so the URL can stay clean', async () => {
    // Reading is what persists them, so the first visit has to actually read.
    (await withUrl('?platform=ios&installed=0')).overrides();
    const { overrides } = await withUrl(''); // "reload" with no query
    assert.deepEqual(overrides(), { platform: 'ios', installed: false });
  });

  test('?reset-overrides clears them', async () => {
    (await withUrl('?permission=denied')).overrides();
    const { overrides } = await withUrl('?reset-overrides');
    assert.deepEqual(overrides(), {});
  });

  test('corrupt storage falls back to none rather than throwing', async () => {
    sessionStorage.setItem('cocktail_dev_overrides', '{not json');
    const { overrides } = await withUrl('');
    assert.deepEqual(overrides(), {});
  });
});

describe('in production', () => {
  test('a query param is ignored entirely', async () => {
    // The one that matters: ?permission= on the live site must do nothing.
    const { overrides } = await withUrl('?permission=granted&platform=ios', false);
    assert.deepEqual(overrides(), {});
  });

  test('a value already in storage is ignored too', async () => {
    // Someone could have set it while running a dev build on the same origin.
    sessionStorage.setItem('cocktail_dev_overrides', JSON.stringify({ permission: 'granted' }));
    const { overrides } = await withUrl('', false);
    assert.deepEqual(overrides(), {});
  });
});

describe('what they let us drive', () => {
  /** Fresh push store with the given overrides in force. */
  async function pushWith(search: string) {
    await withUrl(search);
    return import('$lib/stores/push.svelte');
  }

  test('a browser that has denied notifications can still be shown as "never asked"', async () => {
    // Exactly the case that was untestable: this profile's real permission is
    // permanently 'denied', so the opt-in modal could never render in it.
    vi.stubGlobal('Notification', { permission: 'denied' });
    const { permissionState } = await pushWith('?permission=default');
    assert.equal(permissionState(), 'default');
  });

  test('a desktop can pretend to be an iPhone that has not installed the app', async () => {
    const { needsInstallFirst } = await pushWith('?platform=ios&installed=0&push=unsupported');
    assert.equal(needsInstallFirst(), true, 'iOS needs Home Screen install before push');
  });

  test('…and one that has installed it', async () => {
    const { needsInstallFirst } = await pushWith('?platform=ios&installed=1&push=supported');
    assert.equal(needsInstallFirst(), false);
  });

  test('push support can be switched off', async () => {
    const { pushSupported } = await pushWith('?push=unsupported');
    assert.equal(pushSupported(), false);
  });

  test('with nothing forced, the real browser still decides', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    const { permissionState } = await pushWith('');
    assert.equal(permissionState(), 'denied');
  });
});
