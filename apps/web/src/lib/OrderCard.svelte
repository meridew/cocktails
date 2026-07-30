<script lang="ts">
  /**
   * One order on the bar, as a compact row that expands on demand.
   *
   * The bar screen lives or dies on how many orders fit, so the collapsed row
   * carries only what a bartender reads at a glance — who, what, how long, and the
   * single forward action. Everything else (step back, bump, per-drink ticking,
   * delete) appears only while expanded, so those controls cost no permanent
   * height. The parent keeps at most one card open.
   *
   * All per-status presentation comes from STATUS_META — no parallel maps.
   */
  import { STATUS_META, orderProgress } from '@cocktails/shared';
  import type { Order, OrderStatus } from '@cocktails/shared';

  let {
    order,
    busy,
    expanded,
    ontoggle,
    onact,
    onbump,
    onprogress,
    ondelete,
  }: {
    order: Order;
    busy: boolean;
    expanded: boolean;
    ontoggle: () => void;
    onact: (status: OrderStatus) => void;
    onbump: (bumped: boolean) => void;
    onprogress: (index: number, made: number) => void;
    ondelete: () => void;
  } = $props();

  let meta = $derived(STATUS_META[order.status]);
  let progress = $derived(orderProgress(order));
  let bumped = $derived(order.bumpedAt != null);
  /** Only worth showing per-drink ticking when there's more than one drink. */
  let trackable = $derived(progress.total > 1);

  function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  }
</script>

<article class="ord s-{order.status}" class:is-open={expanded} class:is-bumped={bumped}>
  <!-- The row body is the expand affordance; the action button sits outside it so
       advancing an order never costs an extra tap. -->
  <div class="ord-main">
    <button
      type="button"
      class="ord-summary"
      aria-expanded={expanded}
      onclick={ontoggle}
      title="Show more options"
    >
      <span class="ord-head">
        {#if bumped}<span class="ord-flag" title="Bumped to the front">⤒</span>{/if}
        <span class="ord-who">{order.name}</span>
        <span class="ord-meta">{meta.badge} · {ago(order.createdAt)}</span>
      </span>
      <span class="ord-drinks">
        {#each order.items as item (item.name)}
          <span class="ord-drink" class:is-poured={(item.made ?? 0) >= item.qty}>
            {item.qty}× {item.name}
          </span>
        {/each}
      </span>
      {#if trackable}
        <span class="ord-progress" class:is-complete={progress.complete}>
          {progress.made}/{progress.total} poured
        </span>
      {/if}
      {#if order.note && !expanded}<span class="ord-note-peek">“{order.note}”</span>{/if}
    </button>

    {#if meta.next}
      <button
        type="button"
        class="ord-go {meta.actionClass}"
        disabled={busy}
        onclick={() => onact(meta.next!)}
      >
        {meta.nextLabel}
      </button>
    {:else}
      <button type="button" class="ord-go" disabled={busy} onclick={() => onact('pending')}>
        ↺ Reopen
      </button>
    {/if}
  </div>

  {#if expanded}
    <div class="ord-more">
      {#if order.note}<p class="ord-note">“{order.note}”</p>{/if}

      {#if trackable}
        <div class="ord-pour">
          <h5>Poured</h5>
          {#each order.items as item, index (item.name)}
            <div class="ord-pour-row">
              <span class="ord-pour-name">{item.name}</span>
              <span class="ord-pour-count">{item.made ?? 0}/{item.qty}</span>
              <span class="ord-pour-btns">
                <button
                  type="button"
                  class="ord-step"
                  disabled={busy || (item.made ?? 0) <= 0}
                  aria-label="One fewer {item.name} poured"
                  onclick={() => onprogress(index, (item.made ?? 0) - 1)}>−</button
                >
                <button
                  type="button"
                  class="ord-step"
                  disabled={busy || (item.made ?? 0) >= item.qty}
                  aria-label="One more {item.name} poured"
                  onclick={() => onprogress(index, (item.made ?? 0) + 1)}>+</button
                >
              </span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="ord-tools">
        {#if meta.prev}
          <button
            type="button"
            class="ord-tool"
            disabled={busy}
            onclick={() => onact(meta.prev!)}
            title="Undo — back to {STATUS_META[meta.prev].label}"
          >
            ↩ {STATUS_META[meta.prev].label}
          </button>
        {/if}
        <button
          type="button"
          class="ord-tool"
          aria-pressed={bumped}
          disabled={busy}
          onclick={() => onbump(!bumped)}
        >
          {bumped ? '⤓ Un-bump' : '⤒ Bump to front'}
        </button>
        <button
          type="button"
          class="ord-tool is-danger"
          disabled={busy}
          onclick={ondelete}
          title="Delete this order"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  {/if}
</article>
