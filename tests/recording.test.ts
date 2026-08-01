import { describe, expect, test } from 'vitest';
import { RECORDING_CONSTRAINTS, recorderOptions } from '$lib/sound';

describe('party-sound recording quality', () => {
  test('requests a full-bandwidth microphone signal', () => {
    expect(RECORDING_CONSTRAINTS).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      sampleRate: 48_000,
    });
  });

  test('records at 128 kbps with or without an explicitly supported container', () => {
    expect(recorderOptions()).toEqual({ audioBitsPerSecond: 128_000 });
    expect(recorderOptions('audio/webm;codecs=opus')).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128_000,
    });
  });
});
