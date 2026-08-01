<script lang="ts">
  /**
   * Record one take, listen to it, keep it or bin it.
   *
   * It knows nothing about cues or parties — it hands a data URL to `onkeep` and the
   * caller decides what that is a recording *of*. That is what lets three cues share
   * one recorder without three copies of the microphone handling.
   *
   * ## The container is whatever the browser will give us
   *
   * There is no format every browser records: Chrome and Firefox do Opus in WebM,
   * Safari does AAC in MP4, and asking for the wrong one throws. So we probe rather
   * than assume, and store what came out — the endpoint's allow-list covers all of
   * them, and playback is by `<audio>`, which takes whatever the same browser family
   * produced. Left unset, the browser picks its own default, which is also fine.
   *
   * ## The microphone is released every time
   *
   * `getUserMedia` lights the recording indicator on a phone and keeps it lit until
   * every track is stopped. Forgetting that once means a host's phone shows itself as
   * listening for the rest of the evening, so the stop lives in one place that both
   * the finish path and the teardown path call.
   */
  import { onDestroy } from 'svelte';
  import { MAX_TAKE_SECONDS } from '$lib/shared';

  /**
   * `onkeep` answers whether it actually stored the thing — see `keep` below for why
   * a void return would lose people's recordings.
   */
  let {
    onkeep,
    saving = false,
  }: { onkeep: (audio: string) => Promise<boolean>; saving?: boolean } = $props();

  /** Preference order: the smallest first, since every clip is fetched by every guest. */
  const MIMES = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/webm',
  ] as const;

  const supported = (): string | undefined => {
    if (typeof MediaRecorder === 'undefined') return undefined;
    return MIMES.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });
  };

  const canRecord =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  let recording = $state(false);
  let left = $state(MAX_TAKE_SECONDS);
  let preview = $state<string | null>(null);
  let err = $state('');

  let stream: MediaStream | undefined;
  let rec: MediaRecorder | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let stopper: ReturnType<typeof setTimeout> | undefined;

  /** The one place the microphone is let go of. Safe to call twice. */
  function release(): void {
    clearInterval(ticker);
    clearTimeout(stopper);
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
    rec = undefined;
  }

  onDestroy(release);

  async function start(): Promise<void> {
    if (recording || saving) return;
    err = '';
    preview = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, or no microphone. Both look the same from here and read the same to
      // a host, who only needs to know it isn't going to work.
      err = "Couldn't get at the microphone. Check this site is allowed to use it.";
      return;
    }

    const mimeType = supported();
    const chunks: Blob[] = [];
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      release();
      err = "This browser won't record audio.";
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const type = rec?.mimeType || mimeType || 'audio/webm';
      release();
      recording = false;
      if (!chunks.length) {
        err = 'That came out empty — have another go.';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => (preview = String(reader.result));
      reader.onerror = () => (err = "Couldn't read that back.");
      reader.readAsDataURL(new Blob(chunks, { type }));
    };

    rec.start();
    recording = true;
    left = MAX_TAKE_SECONDS;
    ticker = setInterval(() => (left = Math.max(0, left - 1)), 1000);
    // The cap is enforced here rather than trusted to the host, because a take that
    // runs long is refused by the endpoint after they have already recorded it.
    stopper = setTimeout(stop, MAX_TAKE_SECONDS * 1000);
  }

  function stop(): void {
    clearInterval(ticker);
    clearTimeout(stopper);
    // `stop()` fires `onstop`, which is where everything else happens.
    if (rec?.state === 'recording') rec.stop();
    else {
      release();
      recording = false;
    }
  }

  /**
   * Hand it over, and **only let go if it was taken**.
   *
   * The caller swallows its own errors to show one line rather than a stack, so an
   * awaited call that failed looks exactly like one that worked. Clearing regardless
   * would throw away a recording the host cannot get back — they'd read "that didn't
   * save" next to an empty recorder and have to perform it again.
   */
  const keep = async (): Promise<void> => {
    if (!preview) return;
    if (await onkeep(preview)) preview = null;
  };
</script>

<div class="recorder">
  {#if err}<p class="says says-bad" role="status">{err}</p>{/if}

  {#if !canRecord}
    <p class="row-note">This browser can't record audio. Try it on a phone.</p>
  {:else if recording}
    <div class="row-acts">
      <button type="button" class="btn btn-danger" onclick={stop}>
        ⏹ Stop · {left}s
      </button>
    </div>
  {:else if preview}
    <!-- Hearing it back before it is anybody else's problem. `controls` rather than a
         play button of our own: it gets a scrubber, a duration and a volume control
         for free, all of which are useful when deciding whether a take is any good. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <audio class="recorder-play" src={preview} controls></audio>
    <div class="row-acts">
      <button type="button" class="btn btn-go" disabled={saving} onclick={keep}>
        {saving ? 'Saving…' : 'Keep it'}
      </button>
      <button type="button" class="btn" disabled={saving} onclick={start}>Try again</button>
      <button type="button" class="btn" disabled={saving} onclick={() => (preview = null)}>
        Bin it
      </button>
    </div>
  {:else}
    <div class="row-acts">
      <button type="button" class="btn" disabled={saving} onclick={start}>
        🎙 Record · up to {MAX_TAKE_SECONDS}s
      </button>
    </div>
  {/if}
</div>
