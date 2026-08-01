<script lang="ts">
  /**
   * A host watching their own party — the whole of "watch the queue, nothing more".
   *
   * **There is deliberately not a single control on this page that changes
   * anything.** No advance, no clear, no bump, no helper management. A host is a
   * customer; Dan pours. That restraint is the point of the screen, and the reason
   * it is a separate route rather than a mode of `/bar`: the bar's every affordance
   * is an action, and reusing it would mean hiding most of them and hoping.
   *
   * The server agrees, which is what makes this safe rather than merely tidy — the
   * capability table gives an owner `orders:read` at their own party and nothing
   * else, so the endpoints refuse the rest even if a control appeared here by
   * accident. `tests/host-loop.test.ts` drives exactly that.
   */
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { eventMenu, listOrders, myParties, NotFound, Unauthorized, type Party } from '$lib/api';
  import { ORDER_STATUSES, STATUS_META, type Order, type OrderStatus } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';
  import ShortList from '$lib/components/ShortList.svelte';
  import WorkSheet from '$lib/components/WorkSheet.svelte';

  /** How often to look again. The bar polls at 4s; a spectator can be lazier. */
  const POLL_MS = 8000;

  const eventId = $derived(page.params.id!);

  let party = $state<Party | null>(null);
  let orders = $state<Order[]>([]);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let curating = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  /** So the card can say what the menu leads with without opening the board. */
  let menuSummary = $state<{ featured: number; total: number } | null>(null);

  async function countMenu(): Promise<void> {
    try {
      const menu = await eventMenu(eventId);
      menuSummary = { featured: menu.shortList.length, total: menu.items.length };
    } catch {
      /* the card falls back to its "couldn't count" copy */
    }
  }

  /** Per-status counts, so the page answers "how is it going" at a glance. */
  const counts = $derived(
    Object.fromEntries(
      ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]),
    ) as Record<OrderStatus, number>,
  );
  const waiting = $derived(orders.filter((o) => o.status !== 'done'));

  async function fetchOrders(): Promise<void> {
    try {
      orders = (await listOrders(eventId)).orders;
      error = '';
    } catch (e) {
      if (e instanceof Unauthorized || e instanceof NotFound) {
        // Not theirs, or gone. 404 and 403 are indistinguishable here on purpose.
        await goto('/host', { replaceState: true });
        return;
      }
      error = 'Reconnecting…';
    }
  }

  // The gate decides whether this screen renders at all; this only loads it once it
  // has. It used to guard itself and `goto('/')`, throwing away the URL somebody was
  // trying to reach — a shared link to a party landed on the front door.
  let started = false;
  $effect(() => {
    if (!session.actor.account || started) return;
    started = true;
    void (async () => {
      party = (await myParties().catch(() => null))?.events.find((e) => e.id === eventId) ?? null;
      await Promise.all([fetchOrders(), countMenu()]);
      loading = false;
      timer = setInterval(() => void fetchOrders(), POLL_MS);
    })();
  });

  // Cleanup lives here rather than as onMount's return value: an *async* onMount
  // returns a promise, so anything it returns is never treated as a teardown and the
  // poll would outlive the page.
  onDestroy(() => clearInterval(timer));

  const guestLink = $derived(`${page.url.origin}/e/${eventId}`);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(guestLink);
      notice = 'Guest link copied.';
    } catch {
      notice = guestLink; // clipboard needs permission it may not have
    }
  }

  const ago = (ts: number): string => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  };

  const lines = (o: Order): string => o.items.map((i) => `${i.qty}× ${i.name}`).join(', ');
</script>

<svelte:head><title>{party?.name ?? 'Your party'} · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <!-- Up names where it goes. "Back" used to sit in the same corner that said "Sign
       out" on `/host`, one tap away — which is how you lose a session reaching for
       the back button. -->
  <AppBar up={{ href: '/host', label: 'Your bar' }} title={party?.name ?? 'Your party'} />

  <main class="deck">
    <!--
      **Signed-in, not `orders:read` at this party** — and the difference is a trap
      worth naming. `whoami` deliberately leaves the party half of the actor null for
      an account-holder, because "which party do you mean" is a question only a route
      can answer and guessing it would be the old "whichever is live" mistake wearing
      a new hat. So `can(actor, 'orders:read', party(id))` is false for *every* host
      at their own party, and gating on it locked them all out.

      Whether this party is theirs is the server's answer, and it already gives it:
      `listOrders` 404s for a party that is not yours, and `fetchOrders` sends them
      back to `/host`. The gate's job here is only "is anybody signed in".
    -->
    <Gate what="This party">
      {#if loading}
        <p class="empty">One moment…</p>
      {:else}
        <p class="stat" aria-live="polite">
          <b>{waiting.length}</b>
          {waiting.length === 1 ? 'drink' : 'drinks'} on the go ·
          <b>{counts.done}</b> poured
        </p>

        <section class="panel">
          <h2>Your guests' link</h2>
          <p>Put this under a QR code on the table, or send it round.</p>
          <div class="row-acts">
            <button class="btn btn-go" type="button" onclick={copyLink}>Copy the link</button>
            <!-- "See their menu" said preview; a host is also a person at their own
               party who might want a drink, and this is the same screen either way. -->
            <a class="btn" href="/e/{eventId}">Open the menu</a>
          </div>
        </section>

        <!-- Curating *is* changing something, so it sits oddly next to "not a single
           control that changes anything". It belongs here anyway: the restraint is
           about not letting a host reach into the bar's work — advancing drinks,
           clearing queues, managing helpers — and choosing what their own party
           serves is not that. The capability table already says so: an owner holds
           `menu:curate` and nothing else beyond reading. -->
        <section class="panel">
          <h2>What the bar will make</h2>
          <p class="card-stat">
            {#if !menuSummary}
              <span class="row-note"
                >Pick a handful of favourites, or leave it and guests see everything.</span
              >
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
          <h2>What's happening</h2>
          <!-- Watching, not working. Every row here is a statement, not a button. -->
          {#each waiting as order (order.id)}
            <div class="row">
              <span class="row-main">
                <span class="row-name">{order.name}</span>
                <span class="row-note">{lines(order)}</span>
              </span>
              <span class="row-note">
                {STATUS_META[order.status].label} · {ago(order.createdAt)} ago
              </span>
            </div>
          {:else}
            <p class="empty">
              {counts.done > 0
                ? 'Nothing waiting — the bar is keeping up.'
                : 'No orders yet. They will show up here as your guests order.'}
            </p>
          {/each}
        </section>

        {#if counts.done > 0}
          <section class="panel">
            <h2>Poured so far</h2>
            <p class="pours">
              {#each orders.filter((o) => o.status === 'done') as order (order.id)}
                <span>{order.name}</span>
              {/each}
            </p>
          </section>
        {/if}
      {/if}

      {#if error}<p class="says says-bad" role="status">{error}</p>{/if}
      {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
    </Gate>
  </main>
</div>

{#if curating}
  <WorkSheet
    title="What the bar will make"
    subtitle={party?.name}
    onclose={() => {
      curating = false;
      void countMenu();
    }}
  >
    <ShortList {eventId} />
  </WorkSheet>
{/if}
