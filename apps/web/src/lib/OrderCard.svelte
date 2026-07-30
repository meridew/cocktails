<script lang="ts">
  /**
   * One order on the bar: who, what, and the single forward action. All per-status
   * presentation comes from STATUS_META so there's no parallel map to keep in sync.
   */
  import { STATUS_META } from '@cocktails/shared';
  import type { Order, OrderStatus } from '@cocktails/shared';

  let {
    order,
    busy,
    onact,
    ondelete,
  }: {
    order: Order;
    busy: boolean;
    onact: (status: OrderStatus) => void;
    ondelete: () => void;
  } = $props();

  let meta = $derived(STATUS_META[order.status]);

  function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  }
</script>

<div class="bt-order s-{order.status}">
  <div class="bt-row">
    <span class="bt-name">{order.name}</span>
    <span class="bt-badge b-{order.status}">{meta.badge}</span>
  </div>
  <ul class="bt-items">
    {#each order.items as item (item.name)}<li>{item.qty}× {item.name}</li>{/each}
  </ul>
  {#if order.note}<p class="bt-note">“{order.note}”</p>{/if}
  <div class="bt-foot">
    <span class="bt-ago">{ago(order.createdAt)} ago</span>
    <div class="bt-acts">
      {#if meta.next}
        <button
          type="button"
          class="bt-act {meta.actionClass}"
          disabled={busy}
          onclick={() => onact(meta.next!)}
        >
          {meta.nextLabel}
        </button>
      {:else}
        <button type="button" class="bt-act" disabled={busy} onclick={() => onact('pending')}>
          ↺ Reopen
        </button>
      {/if}
      <button
        type="button"
        class="bt-act del"
        disabled={busy}
        onclick={ondelete}
        aria-label="Delete"
      >
        🗑
      </button>
    </div>
  </div>
</div>
