<script lang="ts">
  /**
   * One party, at its own address.
   *
   * This was `openParty` — a `$state` field on `/admin`. Two levels deep the URL
   * still said `/admin`, so Back left the desk entirely rather than going up, a
   * reload lost your place, and a party could not be linked to or bookmarked.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    deleteParty,
    eventMenu,
    getStock,
    listHosts,
    myParties,
    openBar,
    updateParty,
    type Host,
    type Party,
  } from '$lib/api';
  import { party as partyScope } from '$lib/shared';
  import { adoptApprovedSession, session } from '$lib/stores/session.svelte';
  import { rememberEvent } from '$lib/party';
  import AppBar from '$lib/components/AppBar.svelte';
  import Cupboard from '$lib/components/Cupboard.svelte';
  import Gate from '$lib/components/Gate.svelte';
  import ShortList from '$lib/components/ShortList.svelte';
  import WorkSheet from '$lib/components/WorkSheet.svelte';

  const eventId = $derived(page.params.id!);

  let party = $state<Party | null>(null);
  let host = $state<Host | null>(null);
  let loading = $state(true);
  let busy = $state('');
  let error = $state('');
  let notice = $state('');
  let curating = $state(false);
  let cupboardOpen = $state(false);
  let menuSummary = $state<{ featured: number; total: number } | null>(null);
  /** What the host has in, so the card can say it without opening the tick list. */
  let stock = $state<string[] | null>(null);

  const STATUS_WORD = { draft: 'Not open', live: 'On now', done: 'Finished' } as const;
  const when = (ms: number | null): string =>
    ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'no date';

  const countStock = async (userId: string): Promise<void> => {
    stock = await getStock(userId)
      .then((r) => r.stock)
      .catch(() => null);
  };

  async function countMenu(): Promise<void> {
    try {
      const menu = await eventMenu(eventId);
      menuSummary = { featured: menu.shortList.length, total: menu.items.length };
    } catch {
      /* the card falls back to its "couldn't count" copy */
    }
  }

  let started = false;
  $effect(() => {
    if (!session.actor.account || started) return;
    started = true;
    void (async () => {
      const [p, h] = await Promise.all([
        myParties().catch(() => null),
        listHosts().catch(() => null),
      ]);
      party = p?.events.find((e) => e.id === eventId) ?? null;
      host = h?.hosts.find((x) => x.id === party?.hostUserId) ?? null;
      await countMenu();
      if (host) await countStock(host.id);
      loading = false;
    })();
  });

  async function act(key: string, fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = key;
    error = '';
    notice = '';
    try {
      await fn();
    } catch (e) {
      error = (e as Error).message || "That didn't go through.";
    } finally {
      busy = '';
    }
  }

  const setStatus = (status: 'draft' | 'live' | 'done') =>
    act('status', async () => {
      const { event } = await updateParty(eventId, { status });
      party = event;
      notice = status === 'live' ? `${event.name} is open.` : `${event.name} is ${status}.`;
    });

  const work = () =>
    act('bar', async () => {
      const { token, staff } = await openBar(eventId);
      adoptApprovedSession(token, staff);
      rememberEvent(eventId);
      await goto(`/bar/${eventId}`);
    });

  const remove = () =>
    act('delete', async () => {
      if (!party) return;
      if (!confirm(`Delete ${party.name}? The orders go with it.`)) return;
      await deleteParty(eventId);
      // Up, deliberately: the thing this page was about no longer exists, so staying
      // would leave a screen describing nothing.
      await goto('/admin', { replaceState: true });
    });

  const guestLink = $derived(`${page.url.origin}/e/${eventId}`);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(guestLink);
      notice = 'Guest link copied.';
    } catch {
      notice = guestLink; // clipboard needs permission it may not have
    }
  }
</script>

<svelte:head><title>{party?.name ?? 'Party'} · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <AppBar up={{ href: '/admin', label: 'Parties' }} title={party?.name ?? 'Party'} />

  <main class="deck">
    <Gate capability="party:edit" scope={partyScope(eventId)} what="This party">
      {#if loading}
        <p class="empty">One moment…</p>
      {:else if !party}
        <section class="panel">
          <h2>No such party</h2>
          <p>It may have been deleted.</p>
          <a class="btn btn-go" href="/admin">Back to the parties</a>
        </section>
      {:else}
        {@const p = party}
        <p class="stat">
          {host?.name ?? 'unknown host'} · {when(p.startsAt)}
        </p>

        <section class="panel">
          <h2>The bar</h2>
          <p class="card-stat">
            <span
              class="pill"
              class:pill-live={p.status === 'live'}
              class:pill-done={p.status === 'done'}
            >
              {STATUS_WORD[p.status]}
            </span>
            <span class="row-note">
              {p.status === 'live'
                ? 'Guests can order.'
                : p.status === 'draft'
                  ? "Guests see the menu but can't order yet."
                  : 'The bar has closed.'}
            </span>
          </p>
          <div class="row-acts">
            {#if p.status !== 'live'}
              <!--
                **"Let guests order", not "Open the bar".** That phrase already means
                something else two screens away: on the bar's own gate it takes *you*
                a shift on this device. Two different acts under identical words is
                the same failure the app bar had when one corner meant six things.

                It also says what actually changes, which the status line right above
                it is already phrased in — "Guests see the menu but can't order yet".
              -->
              <button
                class="btn btn-go"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => setStatus('live')}
              >
                Let guests order
              </button>
            {:else}
              <button class="btn btn-go" type="button" disabled={Boolean(busy)} onclick={work}>
                Work it
              </button>
              <button
                class="btn"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => setStatus('done')}
              >
                Stop taking orders
              </button>
            {/if}
          </div>
        </section>

        <!--
          **The cupboard, on the party page.**

          It belongs to the host and is shared across their parties, which is why it
          used to live only on `/admin/h/<id>` — reachable from here through a button
          called "Their account", the card that also holds Suspend and Delete. The
          job on the night before a party is *cupboard, then short list*, in that
          order, because the second is chosen out of what the first makes possible.
          Sending that through the account screen put two taps and a wrong-sounding
          label between two halves of one task.

          The card says whose it is and that it is shared, so editing it here cannot
          be mistaken for a per-party setting.
        -->
        <section class="panel">
          <h2>What {host?.name ?? 'the host'} has in</h2>
          <p class="card-stat">
            {#if stock === null}
              <span class="row-note">Couldn't count it.</span>
            {:else if stock.length === 0}
              <span class="row-note">
                Nothing recorded — the menu falls back to a short standard one.
              </span>
            {:else}
              <b>{stock.length}</b>
              <span class="row-note">
                {stock.length === 1 ? 'thing' : 'things'} · pours
                <b>{menuSummary?.total ?? '…'}</b> drinks
              </span>
            {/if}
          </p>
          <p class="row-note">
            Their cupboard, shared across every party they throw — not just this one.
          </p>
          <button class="btn" type="button" onclick={() => (cupboardOpen = true)}>
            {stock && stock.length > 0 ? 'Change it' : 'Fill it in'}
          </button>
        </section>

        <section class="panel">
          <h2>What the bar will make</h2>
          <p class="card-stat">
            {#if !menuSummary}
              <span class="row-note">Counting…</span>
            {:else if menuSummary.featured === 0}
              <b>{menuSummary.total}</b>
              <span class="row-note">drinks — guests see them all</span>
            {:else}
              <b>{menuSummary.featured}</b>
              <span class="row-note">featured of {menuSummary.total}</span>
            {/if}
          </p>
          <button class="btn" type="button" onclick={() => (curating = true)}>Choose drinks</button>
        </section>

        <section class="panel">
          <h2>Their guests' link</h2>
          <p>Put this under a QR code on the table, or send it round.</p>
          <div class="row-acts">
            <button class="btn" type="button" onclick={copyLink}>Copy the link</button>
            <a class="btn" href="/e/{eventId}">Open the menu</a>
          </div>
        </section>

        {#if host}
          <section class="panel">
            <h2>Whose party it is</h2>
            <div class="row">
              <span class="row-main">
                <span class="row-name">{host.name}</span>
                <span class="row-note">{host.email}</span>
              </span>
              <span class="row-acts">
                <a class="btn" href="/admin/h/{host.id}">Their account</a>
              </span>
            </div>
          </section>
        {/if}

        <!-- Its own card, so it needs no rule above it — `.danger-zone` is for when
             something destructive has to share a card with something ordinary. -->
        <section class="panel">
          <h2>Getting rid of it</h2>
          <p>Deleting this party takes its orders with it. The cupboard is untouched.</p>
          <button class="btn btn-danger" type="button" disabled={Boolean(busy)} onclick={remove}>
            Delete this party
          </button>
        </section>
      {/if}

      {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
      {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
    </Gate>
  </main>
</div>

{#if curating && party}
  <WorkSheet
    title="What the bar will make"
    subtitle={party.name}
    onclose={() => {
      curating = false;
      void countMenu();
    }}
  >
    <ShortList {eventId} />
  </WorkSheet>
{/if}

{#if cupboardOpen && host}
  <!-- Same component the host uses on their own screen — one set of rules about what
       counts as pourable, not two. Closing it re-counts *both* cards, because a
       cupboard change moves what the short list can even offer. -->
  <WorkSheet
    title="What {host.name} has in"
    subtitle="Shared across their parties"
    onclose={() => {
      cupboardOpen = false;
      if (host) void countStock(host.id);
      void countMenu();
    }}
  >
    <Cupboard userId={host.id} onsaved={(saved) => (stock = saved)} />
  </WorkSheet>
{/if}
