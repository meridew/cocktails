<script lang="ts">
  /**
   * The noises a party makes — three moments, and as many takes each as the host
   * wants to record.
   *
   * Two screens use it, like [ShortList] and [MenuExtras]: a host on `/host/<id>` and
   * Dan on `/admin/p/<id>`. `menu:curate` at that party, the same capability that
   * chooses the drinks, because this is taste about your own evening.
   *
   * ## A row per take is the feature
   *
   * The obvious design is one clip per cue. This is several, picked at random, because
   * the fifth guest through the door hearing exactly what the first heard is how a
   * novelty becomes an annoyance. Each take switches off without being deleted, so
   * "not tonight" and "never again" stay different decisions.
   *
   * A cue is live when at least one of its takes is on. There is deliberately no
   * per-cue switch on top of that: two switches that can disagree is a bug with a UI.
   */
  import { onDestroy, onMount } from 'svelte';
  import {
    addTake,
    deleteTake,
    listTakes,
    setTakeEnabled,
    takeAudioUrl,
    Unauthorized,
    type Take,
  } from '$lib/api';
  import { MAX_TAKES_PER_CUE, SOUND_CUES, type SoundCue } from '$lib/shared';
  import SoundRecorder from '$lib/components/SoundRecorder.svelte';

  let { eventId }: { eventId: string } = $props();

  let takes = $state<Take[]>([]);
  let loaded = $state(false);
  /** Which cue is mid-save, so only its recorder greys out. */
  let saving = $state<SoundCue | null>(null);
  /** Which take is mid-flip or mid-delete, so only its row greys out. */
  let busyTake = $state<string | null>(null);
  let err = $state('');

  const forCue = (cue: SoundCue): Take[] => takes.filter((t) => t.cue === cue);
  const liveCues = $derived(SOUND_CUES.filter((c) => forCue(c.key).some((t) => t.enabled)).length);

  async function refresh(): Promise<void> {
    takes = (await listTakes(eventId)).sounds;
  }

  onMount(async () => {
    try {
      await refresh();
      loaded = true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "Couldn't load the sounds";
    }
  });

  /**
   * Run something against the server, showing one message rather than a stack.
   *
   * **Returns whether it worked**, which matters for saving a take: the recorder only
   * lets go of a recording once this says it was stored. See `SoundRecorder.keep`.
   */
  async function attempt(what: () => Promise<void>): Promise<boolean> {
    err = '';
    try {
      await what();
      await refresh();
      return true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't go through";
      return false;
    }
  }

  const save = (cue: SoundCue, audio: string) =>
    attempt(async () => {
      saving = cue;
      try {
        await addTake(eventId, cue, audio);
      } finally {
        saving = null;
      }
    });

  const flip = (t: Take) =>
    attempt(async () => {
      busyTake = t.id;
      try {
        await setTakeEnabled(eventId, t.id, !t.enabled);
      } finally {
        busyTake = null;
      }
    });

  const bin = (t: Take) =>
    attempt(async () => {
      if (!confirm(`Delete ${t.label}? It won't come back.`)) return;
      busyTake = t.id;
      try {
        await deleteTake(eventId, t.id);
      } finally {
        busyTake = null;
      }
    });

  /**
   * Hearing a take back.
   *
   * One element at a time, because two clips of a host's own voice playing over each
   * other is unlistenable — starting a second stops the first. Tapping the one that
   * is playing stops it, which is what the ⏹ is saying.
   */
  let playing = $state<string | null>(null);
  let player: HTMLAudioElement | undefined;

  function preview(t: Take): void {
    player?.pause();
    if (playing === t.id) {
      playing = null;
      return;
    }
    player = new Audio(takeAudioUrl(eventId, t.id));
    player.onended = () => (playing = null);
    playing = t.id;
    void player.play().catch(() => (playing = null));
  }

  onDestroy(() => player?.pause());
</script>

<div class="sounds">
  {#if err}<p class="says says-bad" role="status">{err}</p>{/if}

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else}
    <p class="stat" aria-live="polite">
      <b>{liveCues}</b> of {SOUND_CUES.length} moments have a sound
    </p>

    <p class="empty">
      Record as many as you like for each — the party picks one at random, so nobody hears the same
      clip all night. Guests can turn sounds off on their own phone.
    </p>

    {#each SOUND_CUES as cue (cue.key)}
      {@const mine = forCue(cue.key)}
      <h2>
        <span class="emoji" aria-hidden="true">{cue.emoji}</span>
        {cue.label}
      </h2>
      <p class="row-note">{cue.note}</p>

      {#each mine as t (t.id)}
        <div class="row take" class:is-off={!t.enabled}>
          <span class="row-main">
            <span class="row-name">{t.label}</span>
            <span class="row-note">{t.enabled ? 'In the mix' : 'Kept, not playing'}</span>
          </span>
          <span class="row-acts">
            <button
              type="button"
              class="btn btn-icon"
              aria-label={playing === t.id ? `Stop ${t.label}` : `Play ${t.label}`}
              onclick={() => preview(t)}
            >
              {playing === t.id ? '⏹' : '▶'}
            </button>
            <button
              type="button"
              class="btn"
              role="switch"
              aria-checked={t.enabled}
              disabled={busyTake === t.id}
              onclick={() => flip(t)}
            >
              {t.enabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              class="btn btn-icon btn-danger"
              aria-label="Delete {t.label}"
              disabled={busyTake === t.id}
              onclick={() => bin(t)}
            >
              🗑
            </button>
          </span>
        </div>
      {/each}

      {#if mine.length === 0}
        <p class="empty">Nothing here yet — this moment passes quietly.</p>
      {/if}

      {#if mine.length < MAX_TAKES_PER_CUE}
        <SoundRecorder saving={saving === cue.key} onkeep={(audio) => save(cue.key, audio)} />
      {:else}
        <p class="row-note">
          That's all {MAX_TAKES_PER_CUE} takes this moment can hold. Delete one to record another.
        </p>
      {/if}
    {/each}
  {/if}
</div>
