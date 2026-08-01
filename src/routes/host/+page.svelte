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
  import { page } from '$app/state';
  import { getStock, myParties, type Party } from '$lib/api';
  import { makeable, OPTIONAL_CATEGORIES, platform } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import AlcoholProfile from '$lib/components/AlcoholProfile.svelte';
  import Cupboard from '$lib/components/Cupboard.svelte';
  import Gate from '$lib/components/Gate.svelte';
  import WorkSheet from '$lib/components/WorkSheet.svelte';

  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let notice = $state('');

  /** The tick list is a screen of its own now, not a panel on this one. */
  let cupboardOpen = $state(false);
  let alcoholProfileOpen = $state(false);
  /** What they've got in, so the card can say it without opening anything. */
  let stock = $state<string[] | null>(null);
  const pourable = $derived(stock ? makeable(stock, { ignore: OPTIONAL_CATEGORIES }).length : 0);

  const me = $derived(session.actor.account);

  const countStock = async (userId: string): Promise<void> => {
    stock = await getStock(userId)
      .then((r) => r.stock)
      .catch(() => null);
  };

  /**
   * The load, run once the gate has said we belong here.
   *
   * It used to guard itself — `refreshActor()` then `goto('/')` — which threw away
   * the URL somebody was trying to reach. `<Gate>` owns that now, and it signs people
   * in *here* rather than sending them somewhere else to do it.
   */
  let started = false;
  $effect(() => {
    const account = session.actor.account;
    if (!account || started) return;
    started = true;
    void (async () => {
      parties = (await myParties().catch(() => null))?.events ?? [];
      await countStock(account.id);
      loading = false;
    })();
  });

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

<div class="workshell">
  <!-- Up goes to the front door, which is a real place again now that signing in no
       longer bounces you off it. The corner is Settings; **Sign out moved in there**,
       out of the slot that means "up" on the very next screen along (`/host/<id>`). -->
  <AppBar up={{ href: '/', label: "What's on" }} title="🍸 Your bar" />

  <main class="deck">
    <Gate what="A host's own area">
      {#if loading}
        <p class="empty">One moment…</p>
      {:else}
        <!-- A card that states the number and opens the tick list, rather than *being*
             the tick list. Inline, the cupboard measured 7,859px and pushed "Your
             parties" some nine screens below the fold. -->
        <section class="panel">
          <h2>What you've got in</h2>
          {#if stock === null}
            <p>
              Tick what's actually in the house and we'll work out what the bar can pour. It's
              optional — leave it and your guests just see everything.
            </p>
          {:else if stock.length === 0}
            <p class="card-stat">
              <span class="row-note"
                >Nothing recorded yet — your guests see a short standard menu.</span
              >
            </p>
          {:else}
            <p class="card-stat">
              <b>{stock.length}</b>
              <span class="row-note">
                {stock.length === 1 ? 'thing' : 'things'} in · pours <b>{pourable}</b>
                {pourable === 1 ? 'drink' : 'drinks'}
              </span>
            </p>
          {/if}
          <button class="btn btn-go" type="button" onclick={() => (cupboardOpen = true)}>
            {stock && stock.length > 0 ? 'Change it' : 'Fill it in'}
          </button>
        </section>

        <section class="panel">
          <h2>Party insights</h2>
          <p>Private order and service estimates across your current and previous parties.</p>
          <a class="btn" href="/insights">View party history</a>
        </section>

        <section class="panel">
          <h2>Unit assumptions</h2>
          <p>Record the strengths and measured pours your bar actually uses for future orders.</p>
          <button class="btn" type="button" onclick={() => (alcoholProfileOpen = true)}>
            Bottle strengths and pours
          </button>
        </section>

        <section class="panel">
          <h2>Your parties</h2>
          {#if parties.length === 0}
            <p class="empty">
              None yet — Dan sets those up. Your cupboard is ready whenever he does.
            </p>
          {:else}
            {#each parties as party (party.id)}
              <div class="row">
                <span class="row-main">
                  <span class="row-name">{party.name}</span>
                  <span class="row-note">
                    {party.status}{when(party.startsAt) ? ` · ${when(party.startsAt)}` : ''}
                  </span>
                </span>
                <span class="row-acts">
                  <!--
                    **"Have a drink" is first, and it is a link to the menu.**

                    This page had exactly one link on it — Watch — so a host who wanted
                    a drink at their own party had to go Watch → "See their menu", three
                    taps through a button that sounds like spectating and a link that
                    sounds like previewing. They are a guest at their own party too.

                    Watch, not work: `/host/<id>` is a spectator's view of the night,
                    where every row is a statement and never a button.
                  -->
                  <a class="btn btn-go" href="/e/{party.id}">Have a drink</a>
                  <a class="btn" href="/host/{party.id}">Watch</a>
                  <a class="btn" href="/insights/{party.id}">Insights</a>
                  <button class="btn" type="button" onclick={() => copyLink(party)}>
                    Guest link
                  </button>
                </span>
              </div>
            {/each}
          {/if}
        </section>
      {/if}

      {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
    </Gate>
  </main>
</div>

{#if cupboardOpen && me}
  <WorkSheet title="What you've got in" onclose={() => (cupboardOpen = false)}>
    <Cupboard
      userId={me.id}
      onsaved={(saved) => {
        stock = saved;
        notice = 'Saved.';
      }}
    />
  </WorkSheet>
{/if}

{#if alcoholProfileOpen && me}
  <WorkSheet title="Unit assumptions" onclose={() => (alcoholProfileOpen = false)}>
    <AlcoholProfile userId={me.id} onsaved={() => (notice = 'Unit assumptions saved.')} />
  </WorkSheet>
{/if}
