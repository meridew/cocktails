<script lang="ts">
  /**
   * Which bar?
   *
   * `/bar` used to answer this by reading device storage and hoping. It was wrong
   * whenever the device had since opened another party's menu, and it could not say
   * so because it never knew which party it meant in the first place.
   *
   * So it asks instead. The real bar is `/bar/<id>`; this is the small screen that
   * gets you to one, and it is deliberately built out of the same `can()` the server
   * uses — a bar listed here is a bar the endpoints will honour.
   *
   * Four answers, in the order they are knowable:
   *
   * 1. **A bar session** names exactly one party by construction, so a helper who
   *    already has one is simply taken there.
   * 2. **One bar you may work** — take them, rather than making them tap a list of one.
   * 3. **Several** — list them.
   * 4. **None** — say which of the two reasons it is. A host is not being refused,
   *    they are the wrong person for this screen: their party is a thing to watch.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { myParties, type Party } from '$lib/api';
  import { can, party as partyScope } from '$lib/shared';
  import { hydrateSession, session } from '$lib/stores/session.svelte';
  import { currentEventId } from '$lib/party';

  let parties = $state<Party[]>([]);
  let loading = $state(true);

  const me = $derived(session.actor.account);
  /** Bars this actor may actually work, asked the way the server asks it. */
  const workable = $derived(
    parties.filter(
      (p) => p.status !== 'done' && can(session.actor, 'orders:advance', partyScope(p.id)),
    ),
  );
  /** Somewhere sensible for a host, who has parties but no shift to take at them. */
  const watchable = $derived(parties.filter((p) => p.status !== 'done'));

  /** The party this device last looked at — a hint for a guest, never a permission. */
  let lastSeen = $state<string | null>(null);

  onMount(async () => {
    await hydrateSession();

    // A staff token *is* the answer. No list, no guessing, no request.
    const held = session.actor.party?.id;
    if (held) {
      await goto(`/bar/${held}`, { replaceState: true });
      return;
    }

    lastSeen = currentEventId();
    if (session.actor.account) {
      parties = (await myParties().catch(() => null))?.events ?? [];
      if (workable.length === 1) {
        await goto(`/bar/${workable[0]!.id}`, { replaceState: true });
        return;
      }
    }
    loading = false;
  });
</script>

<svelte:head><title>Which bar? · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <header class="appbar">
    <div class="brand">🍸 Which bar?</div>
    <a class="appbar-bartender appbar-word" href="/">What's on</a>
  </header>

  <main class="deck">
    {#if loading}
      <p class="empty">One moment…</p>
    {:else if workable.length > 0}
      <section class="panel">
        <h2>Bars you can work</h2>
        {#each workable as p (p.id)}
          <div class="row">
            <span class="row-main">
              <span class="row-name">{p.name}</span>
              <span class="row-note">{p.status === 'live' ? 'Taking orders' : 'Not open yet'}</span>
            </span>
            <span class="row-acts">
              <a class="btn btn-go" href="/bar/{p.id}">Work it</a>
            </span>
          </div>
        {/each}
      </section>
    {:else if me && watchable.length > 0}
      <!-- A host, who holds `orders:read` and `menu:curate` at their own party and
           nothing else. Not a refusal — the wrong screen. Theirs is the one that
           watches. -->
      <section class="panel">
        <h2>You're hosting, not pouring</h2>
        <p>Whoever's behind the bar works the queue. Here's yours to watch.</p>
        {#each watchable as p (p.id)}
          <div class="row">
            <span class="row-main"><span class="row-name">{p.name}</span></span>
            <span class="row-acts">
              <a class="btn btn-go" href="/host/{p.id}">Watch</a>
            </span>
          </div>
        {/each}
      </section>
    {:else if lastSeen}
      <!-- No credential, but this device has been to a party. That is very probably
           the bar they mean, and asking to help there is one tap. -->
      <section class="panel">
        <h2>Helping out tonight?</h2>
        <p>The bar you were last at can wave you in — no account needed.</p>
        <a class="btn btn-go" href="/bar/{lastSeen}">I'm pouring here</a>
      </section>
    {:else}
      <section class="panel">
        <h2>Which party?</h2>
        <p>
          Open the link or QR code for the party you're pouring at, and you can ask to help from its
          menu. Or pick it from what's on tonight.
        </p>
        <a class="btn btn-go" href="/">What's on tonight</a>
      </section>
    {/if}
  </main>
</div>
