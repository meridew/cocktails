<script lang="ts">
  /**
   * "Help me choose", at an address.
   *
   * It was `door = 'walk'` — a `$state` field on the menu. A whole view, reachable
   * only by tapping a chip, dismissed only by Escape or its own close button, and
   * invisible to Back. On a phone installed to a Home Screen, where the gesture is
   * *the* way back, the walk was a room you could only leave the way you came.
   *
   * Everything it needs comes from the same `eventMenu` the flat page uses, because
   * two views that disagreed about what is on the menu would be worse than one.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { eventMenu, type EventMenu, type MenuItem } from '$lib/api';
  import { DRINKS } from '$lib/data';
  import { addLine } from '$lib/stores/basket.svelte';
  import ChooseADrink from '$lib/components/ChooseADrink.svelte';
  import AppBar from '$lib/components/AppBar.svelte';

  let { data }: { data: { eventId: string } } = $props();

  let menu = $state<EventMenu | null>(null);

  /** The same fallback the flat menu uses, for the same reason: fail open. */
  const HOUSE: MenuItem[] = DRINKS.map((d) => ({
    id: d.name,
    name: d.name,
    base: d.spirits[0] ?? '',
  }));

  const items = $derived(menu?.items ?? HOUSE);
  const stock = $derived(menu?.stock ?? []);
  const closed = $derived(menu ? menu.event.status !== 'live' : false);

  /** Short list where there is one, everything where there isn't — the menu's rule. */
  const onOffer = $derived.by(() => {
    const list = menu?.shortList ?? [];
    if (list.length === 0) return items;
    const byId = new Map(items.map((i) => [i.id, i]));
    return list.flatMap((id) => {
      const found = byId.get(id);
      return found ? [found] : [];
    });
  });

  const backToMenu = () => goto(`/e/${data.eventId}`);

  onMount(() => {
    void eventMenu(data.eventId)
      .then((r) => (menu = r))
      .catch(() => {
        /* offline — the house list is still something to walk through */
      });
  });
</script>

<svelte:head><title>Help me choose · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <AppBar up={{ href: `/e/${data.eventId}`, label: 'Menu' }} title="Help me choose" />

  <main class="deck">
    <ChooseADrink
      {stock}
      offered={onOffer}
      canOrder={!closed}
      onpick={(name) => {
        addLine(name);
        void backToMenu();
      }}
      onclose={backToMenu}
    />
  </main>
</div>
