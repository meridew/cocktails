<script lang="ts">
  import { visibleAxes, buildLine, defaultConfig, type Drink, type Config } from './data';

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
    // a changed choice can reveal a new axis — give it a default
    for (const a of visibleAxes(drink, config)) {
      if (config[a.key] === undefined) config[a.key] = a.choices[0]!.value;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
  class="overlay"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <div class="sheet" role="document">
    <header>
      <span class="emoji">{drink.emoji}</span>
      <h2>{drink.name}</h2>
    </header>

    {#each axes as axis (axis.key)}
      <div class="axis">
        <span class="axis-label">{axis.label}</span>
        <div class="choices">
          {#each axis.choices as choice (choice.value)}
            <button
              type="button"
              class="chip"
              class:on={config[axis.key] === choice.value}
              onclick={() => pick(axis.key, choice.value)}
            >
              {#if choice.emoji}<span class="ce">{choice.emoji}</span>{/if}{choice.label}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    <p class="recipe">{line.recipe.join(' · ')}</p>

    <div class="actions">
      <button type="button" class="primary" onclick={() => { onadd(line.name); onclose(); }}>
        Add to order
      </button>
      <button type="button" class="ghost" onclick={onclose} aria-label="Close">✕</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.6);
    display: grid;
    align-items: end;
    z-index: 50;
  }
  .sheet {
    background: var(--panel);
    border-top: 2px solid var(--neon-pink);
    border-radius: 18px 18px 0 0;
    padding: 1.25rem;
    max-block-size: 85dvh;
    overflow: auto;
    margin-inline: auto;
    inline-size: min(560px, 100%);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-block-end: 0.75rem;
  }
  header h2 { margin: 0; }
  .emoji { font-size: 2rem; }
  .axis { margin-block: 0.75rem; }
  .axis-label {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
  }
  .choices { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-block-start: 0.4rem; }
  .chip {
    background: var(--surface);
    border: 1.5px solid var(--line);
    color: var(--text);
    padding: 0.5rem 0.9rem;
    border-radius: 999px;
  }
  .chip.on {
    border-color: var(--neon-cyan);
    box-shadow: 0 0 12px rgb(41 255 227 / 0.4);
    color: var(--neon-cyan);
  }
  .ce { margin-inline-end: 0.3rem; }
  .recipe {
    color: var(--muted);
    font-size: 0.85rem;
    margin-block: 1rem 0.5rem;
  }
  .actions { display: flex; gap: 0.6rem; }
  .primary {
    flex: 1;
    background: var(--neon-pink);
    color: #150018;
    border: none;
    font-weight: 700;
    padding: 0.8rem;
    border-radius: 12px;
  }
  .ghost {
    background: transparent;
    border: 1.5px solid var(--line);
    color: var(--text);
    border-radius: 12px;
    padding: 0 1rem;
  }
</style>
