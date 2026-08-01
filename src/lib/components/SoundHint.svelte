<script lang="ts">
  import { Volume2, X } from '@lucide/svelte';
  import type { PartySounds } from '$lib/shared';
  import {
    acknowledgeSoundHint,
    partyHasSounds,
    playCue,
    soundHintSeen,
    soundsMuted,
  } from '$lib/sound';

  let {
    eventId,
    sounds,
    dismissible = false,
    placement = 'menu',
  }: {
    eventId: string;
    sounds: PartySounds;
    dismissible?: boolean;
    placement?: 'arrival' | 'menu';
  } = $props();

  let dismissed = $state(false);
  let seen = $derived(dismissed || soundHintSeen(eventId));
  let show = $derived(!seen && partyHasSounds(sounds) && !soundsMuted());

  function dismiss(): void {
    acknowledgeSoundHint(eventId);
    dismissed = true;
  }
</script>

{#if show}
  <aside class="soundhint soundhint-{placement}" aria-label="Party sound">
    <Volume2 class="soundhint-icon" size={22} strokeWidth={2} aria-hidden="true" />
    <p>
      <strong>This party has sound</strong>
      <span>Turn up your media volume for the full experience. Quiet is fine too.</span>
    </p>
    {#if sounds.join.length > 0}
      <button
        type="button"
        class="soundhint-test"
        aria-label="Test party sound"
        title="Test party sound"
        onclick={() => playCue('join')}
      >
        <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>Test sound</span>
      </button>
    {/if}
    {#if dismissible}
      <button
        type="button"
        class="soundhint-close"
        aria-label="Dismiss sound reminder"
        title="Dismiss"
        onclick={dismiss}
      >
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </aside>
{/if}
