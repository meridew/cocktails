<script lang="ts">
  /**
   * "Add a photo" — the control, used in two places for the same reason.
   *
   * On arrival it sits beside the name field, because a name and a face are the same
   * question asked for the same reason and should not be two interruptions. In
   * Settings it is the way back for everyone who said no the first time, or who took
   * a bad one.
   *
   * **A file input, not a camera API.** `capture="user"` opens the front camera
   * straight away on a phone, and on anything else it opens the picker — so the
   * gallery route comes free, iOS and Android both work, and there is no permission
   * prompt to negotiate or `getUserMedia` stream to tear down. The tradeoff is no
   * live preview before the shutter, which is the phone's own camera UI's job anyway.
   */
  import { forgetPhoto, savePhoto, savedPhoto, shrink } from '$lib/photo';

  let {
    onchange,
  }: {
    /** Fires with the new data URL, or null when they take it back. */
    onchange?: (photo: string | null) => void;
  } = $props();

  let current = $state<string | null>(savedPhoto());
  let busy = $state(false);
  let err = $state('');
  let input = $state<HTMLInputElement>();

  async function chosen(e: Event): Promise<void> {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    busy = true;
    err = '';
    try {
      const small = await shrink(file);
      await savePhoto(small);
      current = small;
      onchange?.(small);
    } catch {
      err = "That picture wouldn't load — try another.";
    } finally {
      busy = false;
      // Cleared so choosing the *same* file again still fires a change event.
      if (input) input.value = '';
    }
  }

  function remove(): void {
    forgetPhoto();
    current = null;
    onchange?.(null);
  }
</script>

<div class="photopick">
  {#if current}
    <!-- `alt=""`: the button beside it already says "Retake", so announcing this as
         "Your photo, image" is noise rather than information. -->
    <img class="photopick-shot" src={current} alt="" width="64" height="64" />
  {/if}

  <div class="photopick-acts">
    <!-- A label rather than a button wrapping the input: tapping a `<label>` opens
         the picker natively, which keeps this working without any JS click-forwarding
         and keeps the whole control one tap. -->
    <label class="btn photopick-take">
      {busy ? 'One moment…' : current ? 'Retake' : '📷 Add a photo'}
      <input
        bind:this={input}
        type="file"
        accept="image/*"
        capture="user"
        disabled={busy}
        onchange={chosen}
      />
    </label>
    {#if current}
      <button type="button" class="btn btn-quiet" onclick={remove}>Remove</button>
    {/if}
  </div>

  {#if err}<p class="says says-bad" role="alert">{err}</p>{/if}
</div>
