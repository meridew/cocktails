<script lang="ts">
  /**
   * A numeric keypad for short codes — the bar PIN and the join code both use it.
   *
   * Big targets, one-thumb reach, and it submits itself on the last digit so the
   * whole thing is one gesture rather than "type, then go find the button". The
   * real `<input>` is kept (not replaced by hand-drawn dots) so hardware keyboards,
   * paste and password managers all still work, and so it masks itself natively.
   */
  let {
    length,
    label,
    disabled = false,
    busy = false,
    onsubmit,
  }: {
    length: number;
    /** Accessible name — these are two different credentials on the same widget. */
    label: string;
    disabled?: boolean;
    busy?: boolean;
    onsubmit: (value: string) => void | Promise<void>;
  } = $props();

  let value = $state('');
  let ready = $derived(value.length === length);

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  function tap(key: string) {
    if (disabled) return;
    if (key === '⌫') {
      value = value.slice(0, -1);
      return;
    }
    if (value.length >= length) return;
    value += key;
    if (value.length === length) void submit();
  }

  async function submit() {
    if (!ready || disabled) return;
    const entered = value;
    // Clear before handing off: a failed attempt should leave an empty field ready
    // for the next try, not the digits that just didn't work.
    value = '';
    await onsubmit(entered);
  }
</script>

<input
  type="password"
  inputmode="numeric"
  aria-label={label}
  autocomplete="one-time-code"
  maxlength={length}
  {value}
  oninput={(e) => {
    // Digits only, so a stray character can never make a valid-looking code.
    value = e.currentTarget.value.replace(/\D/g, '').slice(0, length);
    e.currentTarget.value = value;
  }}
  onkeydown={(e) => e.key === 'Enter' && submit()}
/>

<div class="pin-pad">
  {#each KEYS as key (key)}
    {#if key === ''}
      <span></span>
    {:else}
      <button
        type="button"
        class="pin-key"
        class:is-back={key === '⌫'}
        {disabled}
        onclick={() => tap(key)}
        aria-label={key === '⌫' ? 'Delete last digit' : key}
      >
        {key}
      </button>
    {/if}
  {/each}
</div>

<button type="button" class="bt-unlock" onclick={submit} disabled={disabled || !ready}>
  {busy ? 'Checking…' : 'Unlock'}
</button>
