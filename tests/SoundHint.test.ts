// @vitest-environment jsdom
/** The party-volume reminder shown before a guest's first sound. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SoundHint from '$lib/components/SoundHint.svelte';
import { forgetSounds, loadSounds, muteSounds } from '$lib/sound';
import { NO_SOUNDS, type PartySounds } from '$lib/shared';

const SOUNDS: PartySounds = { join: ['welcome'], add: [], sent: [] };
let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  vi.stubGlobal(
    'Audio',
    class {
      currentTime = 0;
      preload = '';
      play = play;
      pause = vi.fn();
    },
  );
  sessionStorage.clear();
  muteSounds(false);
});

afterEach(() => {
  cleanup();
  forgetSounds();
  muteSounds(false);
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const draw = (eventId = 'party-one', sounds: PartySounds = SOUNDS, dismissible = true) =>
  render(SoundHint, { props: { eventId, sounds, dismissible } });

describe('when the sound hint appears', () => {
  test('offers a real sound check when the party has a welcome clip', async () => {
    loadSounds('party-one', SOUNDS);
    draw();

    expect(screen.getByText('This party has sound')).toBeTruthy();
    expect(screen.getByText(/turn up your media volume/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Test party sound' }));
    expect(play).toHaveBeenCalledOnce();
  });

  test('stays out of parties that have nothing to play', () => {
    draw('quiet-party', NO_SOUNDS);
    expect(screen.queryByLabelText('Party sound')).toBeNull();
  });

  test('honours the existing Party sounds switch', () => {
    muteSounds(true);
    draw();
    expect(screen.queryByLabelText('Party sound')).toBeNull();
  });

  test('does not add a separate dismissal decision to the arrival form', () => {
    draw('party-one', SOUNDS, false);
    expect(screen.queryByRole('button', { name: 'Dismiss sound reminder' })).toBeNull();
  });
});

describe('remembering the answer', () => {
  test('a dismissal lasts for this party session', async () => {
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss sound reminder' }));
    expect(screen.queryByLabelText('Party sound')).toBeNull();

    cleanup();
    draw();
    expect(screen.queryByLabelText('Party sound')).toBeNull();
  });

  test('dismissing one party does not silence another party', async () => {
    draw('party-one');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss sound reminder' }));

    cleanup();
    draw('party-two');
    expect(screen.getByLabelText('Party sound')).toBeTruthy();
  });
});
