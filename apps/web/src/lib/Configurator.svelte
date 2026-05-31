<script lang="ts">
  import { visibleAxes, buildLine, defaultConfig, type Drink, type Config } from './data';
  import { dialog } from './dialog';

  let { drink, onadd, onclose }: {
    drink: Drink;
    onadd: (name: string) => void;
    onclose: () => void;
  } = $props();

  let config = $state<Config>(defaultConfig(drink));
  let axes = $derived(visibleAxes(drink, config));
  let line = $derived(buildLine(drink, config));

  function pick(key: string, value: string) {
    config[key] = value;
    for (const a of visibleAxes(drink, config)) {
      if (config[a.key] === undefined) config[a.key] = a.choices[0]!.value;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-label={`Customise ${drink.name}`}
  tabindex="-1"
  use:dialog={{ onclose }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="sheet-card">
    <button type="button" class="sheet-close" onclick={onclose} aria-label="Close">✕</button>
    <h2><span class="emoji">{drink.emoji}</span> {drink.name}</h2>

    {#each axes as axis (axis.key)}
      <div class="opt">
        <span class="opt-label">{axis.label}</span>
        <div class="seg-group">
          {#each axis.choices as choice (choice.value)}
            <button
              type="button"
              class="seg"
              aria-pressed={config[axis.key] === choice.value}
              onclick={() => pick(axis.key, choice.value)}
            >
              {#if choice.emoji}<span class="emoji">{choice.emoji}</span> {/if}{choice.label}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    <p class="sheet-recipe">{line.recipe.join(' · ')}</p>

    <div class="flowbar">
      <button type="button" class="send flowbar-primary" onclick={() => { onadd(line.name); onclose(); }}>
        Add to order
      </button>
      <button type="button" class="flowbar-back" onclick={onclose}>✕ Back</button>
    </div>
  </div>
</div>
