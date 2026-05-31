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

<div class="bt">
  {#if !unlocked}
    <div class="gate">
      <h2>🍸 Bar</h2>
      <p>Enter staff PIN</p>
      <input
        inputmode="numeric"
        bind:value={pin}
        placeholder="••••"
        onkeydown={(e) => e.key === 'Enter' && unlock()}
      />
      {#if err}<p class="err">{err}</p>{/if}
      <div class="row">
        <button class="primary" onclick={unlock}>Unlock</button>
        <button class="ghost" onclick={onclose}>✕</button>
      </div>
    </div>
  {:else}
    <header class="top">
      <div class="title">
        <h2>🍸 Bar</h2>
        <span class="count" class:zero={waiting === 0}>{waiting} WAITING</span>
      </div>
      <div class="tools">
        <button class="chip" class:on={showDone} onclick={() => (showDone = !showDone)}>
          Show done
        </button>
        <button class="chip" onclick={clearDone}>Clear done</button>
        <button class="x" onclick={onclose} aria-label="Close">✕</button>
      </div>
    </header>

    <div class="list">
      {#each sorted as o (o.id)}
        <div class="order s-{o.status}">
          <div class="orow">
            <span class="name">{o.name}</span>
            <span class="badge b-{o.status}">{BADGE[o.status]}</span>
          </div>
          <div class="items">
            {#each o.items as it (it.name)}<span>{it.qty}× {it.name}</span>{/each}
          </div>
          {#if o.note}<p class="note">“{o.note}”</p>{/if}
          <div class="foot">
            <span class="time">{ago(o.createdAt)} ago</span>
            <div class="acts">
              {#if o.status === 'pending'}
                <button onclick={() => act(o, 'making')}>▶ Start</button>
              {/if}
              {#if o.status === 'making'}
                <button onclick={() => act(o, 'serving')}>🍹 Serve</button>
              {/if}
              {#if o.status === 'serving'}
                <button onclick={() => act(o, 'done')}>✓ Done</button>
              {/if}
              {#if o.status === 'done'}
                <button onclick={() => act(o, 'pending')}>↺ Reopen</button>
              {/if}
              <button class="del" onclick={() => del(o)} aria-label="Delete">🗑</button>
            </div>
          </div>
        </div>
      {/each}
      {#if sorted.length === 0}<p class="empty">No orders yet.</p>{/if}
    </div>
  {/if}
</div>

<style>
  .bt {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 60;
    display: flex;
    flex-direction: column;
  }
  .gate {
    margin: auto;
    text-align: center;
    display: grid;
    gap: 0.6rem;
    padding: 1.5rem;
  }
  .gate input,
  input {
    background: var(--panel);
    border: 1.5px solid var(--line);
    color: var(--text);
    border-radius: 12px;
    padding: 0.7rem;
    font-size: 1.2rem;
    text-align: center;
  }
  .row { display: flex; gap: 0.6rem; justify-content: center; }
  .top {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1rem;
    border-bottom: 1.5px solid var(--line);
    background: var(--panel);
  }
  .title { display: flex; align-items: center; gap: 0.6rem; }
  .title h2 { margin: 0; }
  .count {
    background: var(--neon-pink);
    color: #150018;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.75rem;
  }
  .count.zero { background: var(--line); color: var(--muted); }
  .tools { display: flex; gap: 0.4rem; align-items: center; }
  .chip,
  .x {
    background: transparent;
    border: 1.5px solid var(--line);
    color: var(--text);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
  }
  .chip.on { border-color: var(--neon-cyan); color: var(--neon-cyan); }
  .list { overflow: auto; padding: 0.8rem; display: grid; gap: 0.7rem; }
  .order {
    background: var(--panel);
    border-left: 4px solid var(--line);
    border-radius: 12px;
    padding: 0.8rem;
  }
  .order.s-pending { border-left-color: var(--neon-pink); }
  .order.s-making { border-left-color: var(--neon-cyan); }
  .order.s-serving { border-left-color: var(--neon-yellow); }
  .order.s-done { border-left-color: var(--line); opacity: 0.6; }
  .orow { display: flex; justify-content: space-between; align-items: center; }
  .name { font-weight: 700; font-size: 1.1rem; }
  .badge { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 700; }
  .b-pending { background: var(--neon-pink); color: #150018; }
  .b-making { background: var(--neon-cyan); color: #001a17; }
  .b-serving { background: var(--neon-yellow); color: #1a1700; }
  .b-done { background: var(--line); color: var(--muted); }
  .items { color: var(--muted); font-size: 0.9rem; margin-block: 0.4rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .note { font-style: italic; color: var(--neon-lime); margin: 0.2rem 0; }
  .foot { display: flex; justify-content: space-between; align-items: center; margin-block-start: 0.4rem; }
  .time { color: var(--muted); font-size: 0.8rem; }
  .acts { display: flex; gap: 0.4rem; }
  .acts button {
    background: var(--surface);
    border: 1.5px solid var(--line);
    color: var(--text);
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
  }
  .primary {
    background: var(--neon-pink);
    color: #150018;
    border: none;
    font-weight: 700;
    border-radius: 12px;
    padding: 0.7rem 1.2rem;
  }
  .ghost { background: transparent; border: 1.5px solid var(--line); color: var(--text); border-radius: 12px; padding: 0 1rem; }
  .empty, .err { color: var(--muted); text-align: center; }
  .err { color: var(--neon-pink); }
</style>
