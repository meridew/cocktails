<script lang="ts">
  /**
   * What every route shares: the fonts, the stylesheets, the background confetti
   * cannon, and the two dialogs that can be raised from anywhere (settings, and the
   * one-time notification opt-in).
   *
   * The appbar and tabbar are deliberately *not* here — they belong to the menu, and
   * the bar is a full-screen view of its own. Putting them in the layout would mean
   * hiding them again on /bar.
   */
  import '@fontsource/bungee';
  import '@fontsource/archivo-black';
  import '@fontsource/space-grotesk';
  import '$lib/neo.css';
  import '$lib/app.css';

  import { startBackgroundCannon } from '$lib/confetti';
  import { refreshPushState } from '$lib/stores/push.svelte';
  import { resumeRequest } from '$lib/stores/staffRequest.svelte';
  import NotifyOptIn from '$lib/components/NotifyOptIn.svelte';
  import SettingsSheet from '$lib/components/SettingsSheet.svelte';
  import { settings } from '$lib/stores/view.svelte';

  let { children } = $props();

  // Reconcile a previous visit's notification registration, without prompting.
  void refreshPushState('guest');

  // A request to help must outlive the page: pick up any decision made while the
  // app was closed, and keep watching if it's still outstanding.
  resumeRequest();

  let cannon = $state<HTMLCanvasElement>();
  $effect(() => {
    if (cannon) return startBackgroundCannon(cannon);
  });
</script>

<canvas class="bg-cannon" bind:this={cannon} aria-hidden="true"></canvas>

{@render children()}

{#if settings.open}
  <SettingsSheet onclose={() => (settings.open = false)} />
{/if}
<!-- A dialog, so it sits beside the page rather than inside it: lockBackground
     inerts the mount target's *siblings*, and it must not join the shell grid. -->
<NotifyOptIn />
