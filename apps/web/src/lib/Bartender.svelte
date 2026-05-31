<script lang="ts">
  import { listOrders, setStatus, deleteOrder, clearOrders, Unauthorized } from './api';
  import type { Order, OrderStatus } from '@cocktails/shared';

  let { onclose }: { onclose: () => void } = $props();

  const KEY_STORE = 'cocktail_bt_key';
  let key = $state(localStorage.getItem(KEY_STORE) ?? '');
  let unlocked = $state(false);
  let pin = $state('');
  let err = $state('');
  let orders = $state<Order[]>([]);
  let showDone = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  const RANK: Record<OrderStatus, number> = { pending: 0, making: 1, serving: 2, done: 3 };
  const BADGE: Record<OrderStatus, string> = {
    pending: 'NEW',
    making: 'MAKING',
    serving: 'INCOMING',
    done: 'DONE',
  };

  let sorted = $derived(
    [...orders]
      .sort((a, b) => RANK[a.status] - RANK[b.status] || a.createdAt - b.createdAt)
      .filter((o) => showDone || o.status !== 'done'),
  );
  let waiting = $derived(orders.filter((o) => o.status !== 'done').length);

  async function fetchOrders() {
    try {
      const r = await listOrders(key);
      orders = r.orders;
      unlocked = true;
      err = '';
    } catch (e) {
      if (e instanceof Unauthorized) {
        unlocked = false;
        err = 'Wrong PIN';
        stop();
      }
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
  async function unlock() {
    key = pin.trim() || key;
    if (!key) return;
    localStorage.setItem(KEY_STORE, key);
    await fetchOrders();
    if (unlocked) start();
  }
  async function act(o: Order, status: OrderStatus) {
    await setStatus(o.id, status, key);
    fetchOrders();
  }
  async function del(o: Order) {
    await deleteOrder(o.id, key);
    fetchOrders();
  }
  async function clearDone() {
    await clearOrders('done', key);
    fetchOrders();
  }
  function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  }

  $effect(() => {
    if (key) unlock();
    return () => stop();
  });
</script>

<div class="bartender">
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
      {/if}
      <button type="button" class="bt-x" onclick={onclose} aria-label="Close bartender mode">✕</button>
    </div>
  </header>

  {#if !unlocked}
    <div class="bt-gate">
      <p class="bt-gate-msg">Enter staff PIN</p>
      <input
        inputmode="numeric"
        bind:value={pin}
        placeholder="••••"
        onkeydown={(e) => e.key === 'Enter' && unlock()}
      />
      <button type="button" class="bt-unlock" onclick={unlock}>Unlock</button>
      {#if err}<p class="bt-err">{err}</p>{/if}
    </div>
  {:else}
    <div class="bartender-list">
      {#each sorted as o (o.id)}
        <div class="bt-order s-{o.status}">
          <div class="bt-row">
            <span class="bt-name">{o.name}</span>
            <span class="bt-badge b-{o.status}">{BADGE[o.status]}</span>
          </div>
          <ul class="bt-items">
            {#each o.items as it (it.name)}<li>{it.qty}× {it.name}</li>{/each}
          </ul>
          {#if o.note}<p class="bt-note">“{o.note}”</p>{/if}
          <div class="bt-foot">
            <span class="bt-ago">{ago(o.createdAt)} ago</span>
            <div class="bt-acts">
              {#if o.status === 'pending'}
                <button type="button" class="bt-act start" onclick={() => act(o, 'making')}>▶ Start</button>
              {/if}
              {#if o.status === 'making'}
                <button type="button" class="bt-act serve" onclick={() => act(o, 'serving')}>🍹 Serve</button>
              {/if}
              {#if o.status === 'serving'}
                <button type="button" class="bt-act done" onclick={() => act(o, 'done')}>✓ Done</button>
              {/if}
              {#if o.status === 'done'}
                <button type="button" class="bt-act" onclick={() => act(o, 'pending')}>↺ Reopen</button>
              {/if}
              <button type="button" class="bt-act del" onclick={() => del(o)} aria-label="Delete">🗑</button>
            </div>
          </div>
        </div>
      {/each}
      {#if sorted.length === 0}<p class="bt-empty">No orders yet.</p>{/if}
    </div>
  {/if}
</div>
