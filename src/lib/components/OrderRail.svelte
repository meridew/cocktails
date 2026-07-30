<script lang="ts">
  /**
   * The round: basket, name, note, send. A persistent rail on desktop and a modal
   * sheet on mobile — the parent owns open/closed and the background lock, since
   * the sheet spans both this element and its backdrop.
   */
  import { LIMITS } from '$lib/shared';
  import { basket, setQty, clearBasket, basketCount } from '$lib/stores/basket.svelte';
  import { createOrder } from '$lib/api';
  import { getDeviceId, getSavedName, saveName } from '$lib/device';

  let {
    open,
    onclose,
    onsent,
    rail = $bindable(),
  }: {
    open: boolean;
    onclose: () => void;
    onsent: () => void;
    rail?: HTMLElement;
  } = $props();

  let name = $state(getSavedName());
  let note = $state('');
  let sending = $state(false);
  let errMsg = $state('');

  let count = $derived(basketCount());
  let canSend = $derived(name.trim() !== '' && count > 0 && !sending);

  async function send() {
    if (!canSend) return;
    sending = true;
    errMsg = '';
    try {
      const trimmed = name.trim();
      saveName(trimmed);
      await createOrder({
        name: trimmed,
        items: [...basket.items],
        note: note.trim(),
        deviceId: getDeviceId(),
      });
      clearBasket();
      note = '';
      onsent();
    } catch (e) {
      errMsg = (e as Error).message;
    } finally {
      sending = false;
    }
  }
</script>

<aside class="order-rail" class:open bind:this={rail} aria-label="Your order">
  <section id="order-form">
    <h2>Your order</h2>
    <p class="hint">▶ Add drinks, drop your name, send.</p>

    <div class="basket">
      {#if basket.items.length === 0}
        <p class="basket-empty"><strong>Nothing yet.</strong> Tap a drink to start your round.</p>
      {:else}
        <ul class="basket-list">
          {#each basket.items as item (item.name)}
            <li class="basket-item">
              <span class="basket-item-name">{item.name}</span>
              <div class="qty">
                <button
                  type="button"
                  class="qty-btn"
                  onclick={() => setQty(item.name, item.qty - 1)}
                  aria-label="Less">−</button
                >
                <span class="qty-n">{item.qty}</span>
                <button
                  type="button"
                  class="qty-btn"
                  onclick={() => setQty(item.name, item.qty + 1)}
                  aria-label="More">+</button
                >
              </div>
            </li>
          {/each}
        </ul>
        <button type="button" class="basket-clear" onclick={clearBasket}>Clear all</button>
      {/if}
    </div>

    <!-- maxlength comes from the shared LIMITS the server enforces, so an
         over-long value is prevented here rather than silently truncated there. -->
    <label for="name">Your name</label>
    <input
      id="name"
      bind:value={name}
      placeholder="DANIEL"
      autocomplete="name"
      autocapitalize="words"
      maxlength={LIMITS.maxFieldLen}
    />
    <label for="note">Note (optional)</label>
    <textarea
      id="note"
      bind:value={note}
      placeholder="No ice! Extra lime! Make it spicy!"
      maxlength={LIMITS.maxFieldLen}></textarea>
    {#if errMsg}<p class="status err" role="alert">{errMsg}</p>{/if}

    <div class="flowbar">
      <button type="button" class="send flowbar-primary" disabled={!canSend} onclick={send}>
        {sending ? 'Sending…' : count === 0 ? 'Add something first' : 'Send order'}
      </button>
      <button type="button" class="flowbar-back" onclick={onclose} aria-label="Close order"
        >✕</button
      >
    </div>
  </section>
</aside>
