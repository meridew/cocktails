<script lang="ts">
  /**
   * The bar — a real route now, not an overlay.
   *
   * That change is what makes "where I was" work without any help from us: a
   * refresh, the back button and a shared link all behave the way people expect,
   * and the persisted `view.bar` flag that used to fake it is gone.
   */
  import { goto } from '$app/navigation';
  import Bartender from '$lib/components/Bartender.svelte';
</script>

<svelte:head><title>Bar · COCKTAILS!!!</title></svelte:head>

<Bartender onclose={() => goto('/')} />
