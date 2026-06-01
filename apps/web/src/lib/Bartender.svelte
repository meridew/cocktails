<script lang="ts">
  import { onMount } from 'svelte';
  import { listOrders, setStatus, deleteOrder, clearOrders, login, logout, Unauthorized } from './api';
  import { dialog } from './dialog';
  import { storage } from './storage';
  import { enablePush, pushSupported, pushPermission } from './push';
  import { STATUS_META } from '@cocktails/shared';
  import type { Order, OrderStatus } from '@cocktails/shared';

  let { onclose }: { onclose: () => void } = $props();

  const TOKEN_KEY = 'staff_token'; // bearer session token (replaces the old PIN)
  // CSS modifier for the forward-action button (matches neo.css / app.css colours)
  const ACT_CLASS: Record<OrderStatus, string> = {
    pending: 'start',
    making: 'serve',
    serving: 'done',
    done: '',
  };

  let token = $state(storage.read(TOKEN_KEY) ?? '');
  let unlocked = $state(false); // signed in + first fetch ok
  let email = $state('');
  let password = $state('');
  let loggingIn = $state(false);
  let gateErr = $state('');
  let connErr = $state(''); // transient "reconnecting/failed action" banner
  let loaded = $state(false); // first successful fetch completed
  let orders = $state<Order[]>([]);
  let showDone = $state(false);
  let busy = $state(new Set<string>()); // order ids with an in-flight mutation
  let timer: ReturnType<typeof setInterval> | undefined;

  let sorted = $derived(
    [...orders]
      .sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank || a.createdAt - b.createdAt)
      .filter((o) => showDone || o.status !== 'done'),
  );
  let waiting = $derived(orders.filter((o) => o.status !== 'done').length);

  /** Drop the session locally (expired token, sign-out, or auth error). */
  function signedOut(msg = '') {
    unlocked = false;
    token = '';
    storage.remove(TOKEN_KEY);
    gateErr = msg;
    stop();
  }

  async function fetchOrders() {
    try {
      const r = await listOrders(token);
      orders = r.orders;
      unlocked = true;
      loaded = true;
      gateErr = '';
      connErr = '';
    } catch (e) {
      if (e instanceof Unauthorized) signedOut('Session expired — sign in again.');
      else connErr = 'Reconnecting…';
    }
  }
  function start() {
    stop();
    timer = setInterval(fetchOrders, 4000);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  async function doLogin() {
    const e = email.trim();
    if (!e || !password || loggingIn) return;
    loggingIn = true;
    gateErr = '';
    try {
      const r = await login(e, password);
      token = r.token;
      storage.write(TOKEN_KEY, token);
      password = '';
      await fetchOrders();
      if (unlocked) start();
    } catch (err) {
      gateErr = err instanceof Unauthorized ? 'Wrong email or password' : (err as Error).message;
    } finally {
      loggingIn = false;
    }
  }

  async function doLogout() {
    const t = token;
    signedOut();
    try {
      await logout(t); // best-effort server-side session delete
    } catch {
      /* already signed out locally */
    }
  }

  /** Run a mutation with in-flight guard + error handling. */
  async function withBusy(id: string, fn: () => Promise<void>) {
    if (busy.has(id)) return;
    busy.add(id);
    connErr = '';
    try {
      await fn();
    } catch (e) {
      if (e instanceof Unauthorized) signedOut('Signed out — sign in again.');
      else connErr = (e as Error).message || "That didn't go through — try again.";
    } finally {
      busy.delete(id);
    }
  }

  function act(o: Order, status: OrderStatus) {
    return withBusy(o.id, async () => {
      const r = await setStatus(o.id, status, token);
      // merge the authoritative result to avoid a poll flicker
      orders = orders.map((x) => (x.id === o.id ? r.order : x));
    });
  }
  function del(o: Order) {
    return withBusy(o.id, async () => {
      await deleteOrder(o.id, token);
      orders = orders.filter((x) => x.id !== o.id);
    });
  }
  async function clearDone() {
    try {
      await clearOrders('done', token);
      orders = orders.filter((o) => o.status !== 'done');
    } catch (e) {
      if (e instanceof Unauthorized) signedOut('Signed out — sign in again.');
      else connErr = "Couldn't clear — try again.";
    }
  }

  function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  }

  // push: alert the bar when a new order lands (device-keyed, role=bartender)
  let notify = $state<'idle' | 'working' | 'on' | 'off'>(
    pushPermission() === 'granted' ? 'on' : 'idle',
  );
  async function notifyOrders() {
    notify = 'working';
    const r = await enablePush('bartender');
    notify = r.ok ? 'on' : 'off';
  }

  onMount(() => {
    if (token) {
      // validate the stored session; a 401 drops us back to the sign-in form
      void (async () => {
        await fetchOrders();
        if (unlocked) start();
      })();
    }
    return () => stop();
  });
</script>

<div class="bartender" role="dialog" aria-modal="true" aria-label="Bartender" tabindex="-1" use:dialog={{ onclose }}>
  <header class="bt-top">
    <div class="bt-title">
      <h2>🍸 Bar</h2>
      {#if unlocked}<span class="bt-count" class:zero={waiting === 0}>{waiting} WAITING</span>{/if}
    </div>
    <div class="bt-tools">
      {#if unlocked}
        <button type="button" class="bt-chip" aria-pressed={showDone} onclick={() => (showDone = !showDone)}>
          Show done
        </button>
        <button type="button" class="bt-chip" onclick={clearDone}>Clear done</button>
        {#if pushSupported()}
          <button
            type="button"
            class="bt-chip"
            aria-pressed={notify === 'on'}
            disabled={notify === 'working'}
            onclick={notifyOrders}
          >
            {notify === 'on' ? '🔔 On' : notify === 'working' ? '…' : '🔔 Alerts'}
          </button>
        {/if}
        <button type="button" class="bt-chip" onclick={doLogout}>Log out</button>
      {/if}
      <button type="button" class="bt-x" onclick={onclose} aria-label="Close bartender mode">✕</button>
    </div>
  </header>

  {#if connErr}<p class="bt-conn" role="status">{connErr}</p>{/if}

  {#if !unlocked}
    <div class="bt-gate">
      <p class="bt-gate-msg">Staff sign-in</p>
      <input
        type="email"
        autocomplete="username"
        placeholder="email"
        bind:value={email}
        onkeydown={(e) => e.key === 'Enter' && document.getElementById('bt-pw')?.focus()}
      />
      <input
        id="bt-pw"
        type="password"
        autocomplete="current-password"
        placeholder="password"
        bind:value={password}
        onkeydown={(e) => e.key === 'Enter' && doLogin()}
      />
      <button type="button" class="bt-unlock" onclick={doLogin} disabled={loggingIn}>
        {loggingIn ? 'Signing in…' : 'Sign in'}
      </button>
      {#if gateErr}<p class="bt-err" role="alert">{gateErr}</p>{/if}
    </div>
  {:else}
    <div class="bartender-list">
      {#each sorted as o (o.id)}
        <div class="bt-order s-{o.status}">
          <div class="bt-row">
            <span class="bt-name">{o.name}</span>
            <span class="bt-badge b-{o.status}">{STATUS_META[o.status].badge}</span>
          </div>
          <ul class="bt-items">
            {#each o.items as it (it.name)}<li>{it.qty}× {it.name}</li>{/each}
          </ul>
          {#if o.note}<p class="bt-note">“{o.note}”</p>{/if}
          <div class="bt-foot">
            <span class="bt-ago">{ago(o.createdAt)} ago</span>
            <div class="bt-acts">
              {#if STATUS_META[o.status].next}
                <button
                  type="button"
                  class="bt-act {ACT_CLASS[o.status]}"
                  disabled={busy.has(o.id)}
                  onclick={() => act(o, STATUS_META[o.status].next!)}
                >
                  {STATUS_META[o.status].nextLabel}
                </button>
              {:else}
                <button type="button" class="bt-act" disabled={busy.has(o.id)} onclick={() => act(o, 'pending')}>
                  ↺ Reopen
                </button>
              {/if}
              <button type="button" class="bt-act del" disabled={busy.has(o.id)} onclick={() => del(o)} aria-label="Delete">
                🗑
              </button>
            </div>
          </div>
        </div>
      {/each}
      {#if loaded && sorted.length === 0}<p class="bt-empty">No orders yet.</p>{/if}
      {#if !loaded}<p class="bt-empty">Loading…</p>{/if}
    </div>
  {/if}
</div>
