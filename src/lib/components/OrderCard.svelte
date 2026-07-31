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
  import { HANDOFFS, HANDOFF_META, STATUS_META, orderProgress } from '$lib/shared';
  import type { Handoff, Order, OrderStatus } from '$lib/shared';

  let {
    order,
    busy,
    expanded,
    ontoggle,
    onact,
    onbump,
    onprogress,
    ondelete,
    onadmit,
  }: {
    order: Order;
    busy: boolean;
    expanded: boolean;
    ontoggle: () => void;
    /** `handoff` only applies when serving, and is optional — see HANDOFF_META. */
    onact: (status: OrderStatus, handoff?: Handoff) => void;
    onbump: (bumped: boolean) => void;
    onprogress: (index: number, made: number) => void;
    ondelete: () => void;
    /** Let this guest in, or turn them away. Only offered while `order.newGuest`. */
    onadmit: (block: boolean) => void;
  } = $props();

  let meta = $derived(STATUS_META[order.status]);
  /**
   * A face the bar has not let in yet.
   *
   * The card is otherwise completely ordinary — same place in the queue, same
   * everything — and only its forward action changes, from `Start` to `Admit`. That
   * is the entire admission gate as far as this screen is concerned, and it is why
   * there is no second screen: an order nobody can see is an order nobody notices
   * going missing.
   */
  let awaiting = $derived(order.newGuest === true);
  let progress = $derived(orderProgress(order));
  let bumped = $derived(order.bumpedAt != null);
  /** Only worth showing per-drink ticking when there's more than one drink. */
  let trackable = $derived(progress.total > 1);
  /**
   * The handoff choice only exists at the moment of serving. The collapsed row's
   * one-tap "🍹 Ready" stays neutral; these say *how* it's reaching them, which
   * changes the guest's notification wording.
   */
  let choosingHandoff = $derived(order.status === 'making');

  function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  }
</script>

<article
  class="ord s-{order.status}"
  class:is-open={expanded}
  class:is-bumped={bumped}
  class:is-unadmitted={awaiting}
>
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
        <!--
          "Not in", not "new".

          This pill and the status badge beside it were both the word NEW, meaning
          two unrelated things a centimetre apart: this one says *the bar has not let
          this person in*, and `meta.badge` says *this drink has not been started*.
          An un-admitted guest therefore read "ZOË new NEW · 9m", which is a stutter
          that hides a real distinction.

          "Not in" also stays true for a guest who was turned away and has ordered
          again — `newGuest` is anything-but-admitted, so this pill covers blocked as
          well as pending, and there is nothing new about someone you already said no
          to. See the note in db.ts on why that is a single boolean.
        -->
        {#if awaiting}<span class="ord-unadmitted">not in</span>{/if}
        <span class="ord-meta">
          {meta.badge} · {ago(order.createdAt)}{#if order.handoff}
            <span class="ord-hand-flag" title="Guest was {HANDOFF_META[order.handoff].note}">
              {HANDOFF_META[order.handoff].icon}
            </span>
          {/if}
        </span>
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

    {#if awaiting}
      <!-- Two answers, because "no" needs to be as cheap as "yes": a stranger who
           found the domain should cost one tap, not a delete plus watching them
           order again. Admitting is per *guest*, so it releases everything they
           have ordered and everything they order later tonight. -->
      <span class="ord-admit">
        <button type="button" class="ord-go start" disabled={busy} onclick={() => onadmit(false)}>
          ✓ Admit
        </button>
        <button
          type="button"
          class="ord-go ord-reject"
          disabled={busy}
          onclick={() => onadmit(true)}
          aria-label="Turn away {order.name}"
        >
          ✕
        </button>
      </span>
    {:else if meta.next}
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

      {#if choosingHandoff}
        <div class="ord-hand">
          <h5>Ready — and tell them how</h5>
          <div class="ord-hand-btns">
            {#each HANDOFFS as option (option)}
              <button
                type="button"
                class="ord-go {HANDOFF_META[option].actionClass}"
                disabled={busy}
                onclick={() => onact('serving', option)}
              >
                {HANDOFF_META[option].label}
              </button>
            {/each}
          </div>
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
