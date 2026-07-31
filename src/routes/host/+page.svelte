<script lang="ts">
  /**
   * A host's own area: their cupboard, and the parties Dan has set up for them.
   *
   * **A host is a customer.** They do not create parties, take orders, approve
   * helpers or open bars — Dan does. Their whole job is to say what they've got in
   * and watch on the night, so this screen is deliberately small. Every control that
   * used to be here and isn't now was one a host should never have had: this page
   * previously carried sign-in, sign-up, "create a party" and "open the bar",
   * because it was the *only* door and had to be all of them.
   *
   * Signing in moved to `/` — the front door routes people here once it knows what
   * they are. The cupboard is the same component Dan uses from `/admin`, because it
   * is the same list under the same rules; two copies would be two sets of decisions
   * about what counts as pourable.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { myParties, signOutOfAccount, type Party } from '$lib/api';
  import { refreshActor, session } from '$lib/stores/session.svelte';
  import Cupboard from '$lib/components/Cupboard.svelte';

  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let notice = $state('');

  const me = $derived(session.actor.account);

  onMount(async () => {
    await refreshActor();
    if (!session.actor.account) {
      await goto('/', { replaceState: true });
      return;
    }
    parties = (await myParties().catch(() => null))?.events ?? [];
    loading = false;
  });

  const leave = async () => {
    await signOutOfAccount().catch(() => {});
    await refreshActor();
    await goto('/', { replaceState: true });
  };

  const guestLink = (party: Party): string => `${page.url.origin}/e/${party.id}`;

  async function copyLink(party: Party): Promise<void> {
    try {
      await navigator.clipboard.writeText(guestLink(party));
      notice = 'Guest link copied.';
    } catch {
      notice = guestLink(party); // clipboard needs permission it may not have
    }
  }

  const when = (ms: number | null): string =>
    ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
</script>

<svelte:head><title>Your bar · COCKTAILS!!!</title></svelte:head>

<header class="appbar">
  <div class="brand">🍸 Your bar</div>
  <button class="appbar-bartender" type="button" onclick={leave}>Sign out</button>
</header>

<main class="host">
  {#if loading}
    <p class="host-quiet">One moment…</p>
  {:else}
    <h1 class="host-h1">What you've got in</h1>
    <p class="host-quiet">
      Tick what's actually in the house and we'll work out what the bar can pour. It's optional —
      leave it and your guests just see everything.
    </p>

    {#if me}
      <Cupboard userId={me.id} onsaved={() => (notice = 'Saved.')} />
    {/if}

    <section class="bt-staff-group">
      <h4>Your parties</h4>
      {#if parties.length === 0}
        <p class="bt-empty">
          None yet — Dan sets those up. Your cupboard is ready whenever he does.
        </p>
      {:else}
        {#each parties as party (party.id)}
          <div class="bt-staff-row">
            <div class="bt-staff-who">
              <span class="bt-name">{party.name}</span>
              <span class="bt-ago">
                {party.status}{when(party.startsAt) ? ` · ${when(party.startsAt)}` : ''}
              </span>
            </div>
            <div class="bt-acts">
              {#if party.status === 'live'}
                <!-- Watch, not work. There is deliberately no control here that
                     changes anything about the queue — see the capability table. -->
                <a class="bt-act" href="/e/{party.id}">See the menu</a>
              {/if}
              <button class="bt-act" type="button" onclick={() => copyLink(party)}>
                Guest link
              </button>
            </div>
            <code class="host-link">{guestLink(party)}</code>
          </div>
        {/each}
      {/if}
    </section>
  {/if}

  {#if notice}<p class="host-good" role="status">{notice}</p>{/if}
</main>
