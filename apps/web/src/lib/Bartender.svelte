<script lang="ts">
  /**
   * Bar mode: the live order queue. Sign-in lives in StaffGate and the token lives
   * in the session store, so this component only polls and mutates — it never sees
   * a credential.
   *
   * Layout priority is "how many orders can a bartender see at once": a one-line
   * header, status tabs that double as the queue overview, and compact cards that
   * only reveal their extra controls when opened.
   */
  import { onMount } from 'svelte';
  import {
    listOrders,
    setStatus,
    deleteOrder,
    clearOrders,
    listStaff,
    bumpOrder,
    setItemProgress,
    Unauthorized,
    NotFound,
  } from './api.ts';
  import { dialog } from './dialog.ts';
  import {
    enableIfPermitted,
    enablePush,
    pushSupported,
    pushState,
    refreshPushState,
  } from './push.svelte';
  import { hydrateSession, session, signOut } from './session.svelte';
  import StaffGate from './StaffGate.svelte';
  import StaffAdmin from './StaffAdmin.svelte';
  import BarMenu from './BarMenu.svelte';
  import OrderCard from './OrderCard.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { canApproveStaff, ORDER_STATUSES, STATUS_META } from '@cocktails/shared';
  import type { Handoff, Order, OrderStatus, Staff } from '@cocktails/shared';
  import { view } from './view.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const POLL_MS = 4000;
  /** Scopes the in-flight guard for actions that aren't tied to one order. */
  const BULK = '__bulk';

  let loaded = $state(false); // first successful fetch completed
  let connErr = $state(''); // transient "reconnecting / action failed" banner
  let orders = $state<Order[]>([]);
  // Filter and sort live in the view store: a bartender who reloads mid-service
  // should come back to the queue they had set up, not a reset one.
  let filter = $derived(view.barFilter);
  let sort = $derived(view.barSort);
  let openId = $state<string | null>(null); // at most one card expanded
  let menuOpen = $state(false);
  let busy = new SvelteSet<string>(); // order ids with an in-flight mutation
  let timer: ReturnType<typeof setInterval> | undefined;

  let signedIn = $derived(session.signedIn);
  let notify = $derived(pushState('bartender'));

  // Staff administration, admins only.
  let isAdmin = $derived(canApproveStaff(session.staff));
  let showStaff = $state(false);
  let staff = $state<Staff[]>([]);
  let staffLoaded = $state(false);
  let pendingCount = $derived(staff.filter((s) => s.status === 'pending').length);

  /** Per-status counts, so the tabs double as the at-a-glance queue overview. */
  let counts = $derived(
    Object.fromEntries(
      ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]),
    ) as Record<OrderStatus, number>,
  );
  let activeCount = $derived(orders.filter((o) => o.status !== 'done').length);

  let visible = $derived(
    orders
      .filter((o) => (filter === 'active' ? o.status !== 'done' : o.status === filter))
      .sort((a, b) => {
        // Bumped orders always lead, most recently bumped first — that's the point
        // of bumping, so it outranks the chosen sort.
        if ((a.bumpedAt ?? 0) !== (b.bumpedAt ?? 0)) return (b.bumpedAt ?? 0) - (a.bumpedAt ?? 0);
        if (filter === 'active' && a.status !== b.status) {
          return STATUS_META[a.status].rank - STATUS_META[b.status].rank;
        }
        return sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
      }),
  );

  async function fetchOrders() {
    // Yield while a mutation is in flight: replacing the whole array with a
    // snapshot taken before it committed makes a status visibly revert.
    if (busy.size > 0) return;

    const started = session.generation;
    try {
      const r = await listOrders();
      if (started !== session.generation) return; // session dropped mid-flight
      orders = r.orders;
      loaded = true;
      connErr = '';
    } catch (e) {
      if (started !== session.generation) return;
      // A 401 already ended the session inside api.ts; nothing to do here.
      if (!(e instanceof Unauthorized)) connErr = 'Reconnecting…';
    }
  }

  /** Admins also poll the staff list, so a new request shows up without a refresh. */
  async function fetchStaff() {
    if (!canApproveStaff(session.staff)) return;
    const started = session.generation;
    try {
      const r = await listStaff();
      if (started !== session.generation) return;
      staff = r.staff;
      staffLoaded = true;
    } catch {
      /* transient, or a 401 that api.ts already handled */
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(() => {
      void fetchOrders();
      void fetchStaff();
    }, POLL_MS);
  }
  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  /** Load the queue and begin polling; also reconciles the bar's push state. */
  async function begin() {
    // Recover the role first: a reload keeps the token but not who we are, and
    // the admin controls depend on knowing.
    await hydrateSession();
    await fetchOrders();
    if (!session.signedIn) return;
    startPolling();
    void fetchStaff();
    // One opt-in applies everywhere: someone who already allowed notifications as a
    // guest should start getting order alerts on signing in, not meet a second
    // consent step for a permission they've already given.
    void refreshPushState('bartender').then((state) => {
      if (state === 'idle') void enableIfPermitted('bartender');
    });
  }

  /**
   * Start (and stop) working whenever the session comes or goes.
   *
   * This deliberately watches the session rather than being called by the gate:
   * a helper's approval signs them in from the store, which unmounts StaffGate in
   * the same update — so anything the gate scheduled on its way out never ran, and
   * the queue sat on "Loading…" forever. Ownership belongs here, with the polling.
   */
  let running = false;
  $effect(() => {
    // The one tracked read. Everything below is guarded against re-entry, because
    // begin() writes session state that would otherwise re-trigger this effect.
    if (!session.signedIn) {
      running = false;
      stopPolling();
      return;
    }
    if (running) return;
    running = true;
    void begin();
  });

  /** One in-flight guard and one error path for every mutation. */
  async function mutate(id: string, fn: () => Promise<void>) {
    if (busy.has(id)) return;
    busy.add(id);
    connErr = '';
    const started = session.generation;
    try {
      await fn();
    } catch (e) {
      if (started !== session.generation) return;
      if (!(e instanceof Unauthorized)) {
        connErr = (e as Error).message || "That didn't go through — try again.";
      }
    } finally {
      busy.delete(id);
    }
  }

  /** Replace one order with the authoritative row, so the next poll can't flicker. */
  const merge = (updated: Order) => {
    orders = orders.map((o) => (o.id === updated.id ? updated : o));
  };

  const act = (o: Order, status: OrderStatus, handoff?: Handoff) =>
    mutate(o.id, async () => merge((await setStatus(o.id, status, handoff)).order));

  const bump = (o: Order, bumped: boolean) =>
    mutate(o.id, async () => merge((await bumpOrder(o.id, bumped)).order));

  const progress = (o: Order, index: number, made: number) =>
    mutate(o.id, async () => merge((await setItemProgress(o.id, index, made)).order));

  const del = (o: Order) =>
    mutate(o.id, async () => {
      try {
        await deleteOrder(o.id);
      } catch (e) {
        // Another bartender already removed it — the goal is met either way.
        if (!(e instanceof NotFound)) throw e;
      }
      orders = orders.filter((x) => x.id !== o.id);
      if (openId === o.id) openId = null;
    });

  const clearDone = () =>
    mutate(BULK, async () => {
      await clearOrders('done');
      orders = orders.filter((o) => o.status !== 'done');
    });

  async function handleSignOut() {
    stopPolling();
    orders = [];
    staff = [];
    loaded = false;
    staffLoaded = false;
    showStaff = false;
    openId = null;
    await signOut();
  }

  /** Label for the alerts row in the overflow menu; null when it can't be offered. */
  let pushLabel = $derived(
    !pushSupported() || notify === 'unsupported' || notify === 'disabled'
      ? null
      : notify === 'on'
        ? 'On'
        : notify === 'denied'
          ? 'Blocked'
          : notify === 'working'
            ? 'Enabling…'
            : 'Off',
  );

  // A stored token might be expired; the first fetch decides, and a 401 drops us
  // back to the gate via the session store. (The effect above does the starting;
  // this only guarantees the timer dies with the panel.)
  onMount(() => () => stopPolling());
</script>

<div
  class="bartender"
  role="dialog"
  aria-modal="true"
  aria-label="Bar"
  tabindex="-1"
  use:dialog={{ onclose }}
>
  <header class="bar-top">
    <h2>🍸 Bar</h2>
    {#if signedIn}
      <span class="bar-count" class:zero={activeCount === 0}>{activeCount}</span>
    {/if}
    <span class="bar-spacer"></span>
    {#if signedIn}
      <button
        type="button"
        class="bar-icon"
        aria-label={pendingCount ? `Bar options — ${pendingCount} staff waiting` : 'Bar options'}
        onclick={() => (menuOpen = true)}
      >
        ⋯{#if isAdmin && pendingCount}<b class="bar-dot"></b>{/if}
      </button>
    {/if}
    <button type="button" class="bar-icon" onclick={onclose} aria-label="Close bar mode">✕</button>
  </header>

  {#if connErr}<p class="bt-conn" role="status">{connErr}</p>{/if}

  {#if !signedIn}
    <StaffGate onasked={onclose} />
  {:else if showStaff && isAdmin}
    <StaffAdmin
      {staff}
      loaded={staffLoaded}
      onchanged={fetchStaff}
      onclose={() => (showStaff = false)}
    />
  {:else}
    <!-- Tabs are both the filter and the queue overview, which is why there's no
         separate "show done" control any more: Done is simply a tab. -->
    <nav class="bar-tabs" aria-label="Filter orders">
      <button
        type="button"
        class="bar-tab"
        aria-current={filter === 'active'}
        onclick={() => (view.barFilter = 'active')}
      >
        Active <b>{activeCount}</b>
      </button>
      {#each ORDER_STATUSES as status (status)}
        <button
          type="button"
          class="bar-tab"
          aria-current={filter === status}
          onclick={() => (view.barFilter = status)}
        >
          {STATUS_META[status].label} <b>{counts[status]}</b>
        </button>
      {/each}
    </nav>

    <div class="bar-list">
      {#each visible as order (order.id)}
        <OrderCard
          {order}
          busy={busy.has(order.id)}
          expanded={openId === order.id}
          ontoggle={() => (openId = openId === order.id ? null : order.id)}
          onact={(status, handoff) => act(order, status, handoff)}
          onbump={(bumped) => bump(order, bumped)}
          onprogress={(index, made) => progress(order, index, made)}
          ondelete={() => del(order)}
        />
      {/each}
      {#if loaded && visible.length === 0}
        <!-- No celebration here: an empty queue is just the normal state of a bar
             that's keeping up, and a party popper sitting mid-screen reads as a
             stray graphic rather than as information. -->
        <p class="bt-empty">
          {filter === 'active' ? 'Nothing waiting.' : `No ${filter} orders.`}
        </p>
      {/if}
      {#if !loaded}<p class="bt-empty">Loading…</p>{/if}
    </div>
  {/if}
</div>

{#if menuOpen}
  <BarMenu
    {isAdmin}
    pendingStaff={pendingCount}
    {sort}
    {pushLabel}
    onstaff={() => (showStaff = true)}
    onsort={() => (view.barSort = sort === 'oldest' ? 'newest' : 'oldest')}
    onpush={() => void enablePush('bartender')}
    onclearDone={clearDone}
    onsignout={handleSignOut}
    onclose={() => (menuOpen = false)}
  />
{/if}
