<script lang="ts">
  /**
   * One bar, named in its own address.
   *
   * **This is the fix for the worst thing in the navigation audit.** The bar used to
   * live at `/bar` and learn which party it was serving by reading `event_id` out of
   * device storage — a value that `/e/<id>`'s loader rewrites on *every* guest menu
   * that gets opened. So tapping any other party's link silently repointed the bar.
   *
   * The server was never fooled (`partyInScope` prefers the staff token's own event),
   * but the client asked `can(actor, 'orders:advance', party(storedId))` — the party
   * in storage, not the party the token was for. A helper whose device had wandered
   * got their queue replaced mid-shift by "Helping out tonight?", with nothing on
   * screen to explain it and no control to put it back.
   *
   * With the party in the path, the question and the credential are about the same
   * party by construction. The bar can also finally *say* which bar it is, two bars
   * can be worked in two tabs, and the URL can be bookmarked or sent to somebody.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { can, party as partyScope } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import { rememberEvent } from '$lib/party';
  import Bartender from '$lib/components/Bartender.svelte';

  const eventId = $derived(page.params.id!);

  // Still worth remembering — not for permission, which is what went wrong, but so a
  // guest who wandered in here and asked to help lands back on the right menu.
  $effect(() => rememberEvent(eventId));

  /**
   * Where "up" goes, and it depends on who is standing here.
   *
   * The ✕ used to always go to `/e/<id>`, which is right for a helper — they are a
   * guest at this party too — and a dead end for Dan, who arrived from the desk and
   * had nothing to get back to it with. An admin's up is the party's page; everyone
   * else's is the menu.
   */
  const up = $derived(
    can(session.actor, 'party:edit', partyScope(eventId))
      ? { href: `/admin/p/${eventId}`, label: 'The party' }
      : { href: `/e/${eventId}`, label: 'Menu' },
  );
</script>

<svelte:head><title>Bar · COCKTAILS!!!</title></svelte:head>

<Bartender {eventId} {up} onclose={() => goto(`/e/${eventId}`)} />
