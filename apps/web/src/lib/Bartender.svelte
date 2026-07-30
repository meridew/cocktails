<script lang="ts">
  /**
   * Bartender mode: the live order queue. Sign-in lives in StaffGate and the
   * token lives in the session store, so this component only has to poll and
   * mutate — it never sees a credential.
   */
  import { onMount } from 'svelte';
  import {
    listOrders,
    setStatus,
    deleteOrder,
    clearOrders,
    listStaff,
    Unauthorized,
    NotFound,
  } from './api.ts';
  import { dialog } from './dialog.ts';
  import { enablePush, pushSupported, pushState, refreshPushState } from './push.svelte';
  import { hydrateSession, session, signOut } from './session.svelte';
  import StaffGate from './StaffGate.svelte';
  import StaffAdmin from './StaffAdmin.svelte';
  import OrderCard from './OrderCard.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { canApproveStaff, STATUS_META } from '@cocktails/shared';
  import type { Order, OrderStatus, Staff } from '@cocktails/shared';

  let { onclose }: { onclose: () => void } = $props();

  const POLL_MS = 4000;
  /** Scopes the in-flight guard for actions that aren't tied to one order. */
  const BULK = '__bulk';

  let loaded = $state(false); // first successful fetch completed
  let connErr = $state(''); // transient "reconnecting / action failed" banner
  let orders = $state<Order[]>([]);
  let showDone = $state(false);
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

  let sorted = $derived(
    [...orders]
      .sort(
        (a, b) =>
          STATUS_META[a.status].rank - STATUS_META[b.status].rank || a.createdAt - b.createdAt,
      )
      .filter((o) => showDone || o.status !== 'done'),
  );
  let waiting = $derived(orders.filter((o) => o.status !== 'done').length);

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
    void refreshPushState('bartender');
  }

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

  const act = (o: Order, status: OrderStatus) =>
    mutate(o.id, async () => {
      const r = await setStatus(o.id, status);
      // Merge the authoritative row so the next poll doesn't flicker.
      orders = orders.map((x) => (x.id === o.id ? r.order : x));
    });

  const del = (o: Order) =>
    mutate(o.id, async () => {
      try {
        await deleteOrder(o.id);
      } catch (e) {
        // Another bartender already removed it — the goal is met either way.
        if (!(e instanceof NotFound)) throw e;
      }
      orders = orders.filter((x) => x.id !== o.id);
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
    await signOut();
  }

  onMount(() => {
    // A stored token might be expired; the first fetch decides, and a 401 drops
    // us back to the gate via the session store.
    if (session.signedIn) void begin();
    return () => stopPolling();
  });
</script>

<div
  class="bartender"
  role="dialog"
  aria-modal="true"
  aria-label="Bartender"
  tabindex="-1"
  use:dialog={{ onclose }}
>
  <header class="bt-top">
    <div class="bt-title">
      <h2>🍸 Bar</h2>
      {#if signedIn}<span class="bt-count" class:zero={waiting === 0}>{waiting} WAITING</span>{/if}
    </div>
    <div class="bt-tools">
      {#if signedIn}
        {#if isAdmin}
          <!-- The badge is why an admin doesn't have to keep checking. -->
          <button
            type="button"
            class="bt-chip"
            aria-pressed={showStaff}
            aria-label={pendingCount
              ? `Bar staff — ${pendingCount} request${pendingCount === 1 ? '' : 's'} waiting`
              : 'Bar staff'}
            onclick={() => (showStaff = !showStaff)}
          >
            Staff{#if pendingCount}<b class="bt-chip-badge">{pendingCount}</b>{/if}
          </button>
        {/if}
        <button
          type="button"
          class="bt-chip"
          aria-pressed={showDone}
          onclick={() => (showDone = !showDone)}
        >
          Show done
        </button>
        <button type="button" class="bt-chip" onclick={clearDone}>Clear done</button>
        {#if pushSupported() && notify !== 'unsupported' && notify !== 'disabled'}
          <button
            type="button"
            class="bt-chip"
            aria-pressed={notify === 'on'}
            disabled={notify === 'working' || notify === 'on'}
            onclick={() => enablePush('bartender')}
          >
            {notify === 'on'
              ? '🔔 On'
              : notify === 'working'
                ? '…'
                : notify === 'denied'
                  ? '🔔 Blocked'
                  : '🔔 Alerts'}
          </button>
        {/if}
        <button type="button" class="bt-chip" onclick={handleSignOut}>Log out</button>
      {/if}
      <button type="button" class="bt-x" onclick={onclose} aria-label="Close bartender mode"
        >✕</button
      >
    </div>
  </header>

  {#if connErr}<p class="bt-conn" role="status">{connErr}</p>{/if}

  {#if !signedIn}
    <StaffGate onsignedin={begin} />
  {:else if showStaff && isAdmin}
    <StaffAdmin
      {staff}
      loaded={staffLoaded}
      onchanged={fetchStaff}
      onclose={() => (showStaff = false)}
    />
  {:else}
    <div class="bartender-list">
      {#each sorted as o (o.id)}
        <OrderCard
          order={o}
          busy={busy.has(o.id)}
          onact={(status) => act(o, status)}
          ondelete={() => del(o)}
        />
      {/each}
      {#if loaded && sorted.length === 0}<p class="bt-empty">No orders yet.</p>{/if}
      {#if !loaded}<p class="bt-empty">Loading…</p>{/if}
    </div>
  {/if}
</div>
