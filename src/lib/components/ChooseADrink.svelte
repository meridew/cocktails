<script lang="ts">
  /**
   * "Help me choose" — the interactive walk, finally wired to something.
   *
   * `reachable()` has been ported, tested and **unused** since phase 3. It is the
   * other direction through the same data as `makeable()`: the cupboard asks "which
   * recipes need nothing I haven't got", and this asks "which recipes contain
   * everything picked so far". Sharing the data was the win; sharing the predicate
   * would have been a quiet bug — with a small cupboard the wrong one returns the
   * elaborate drinks rather than the simple ones, which reads as odd rather than
   * broken.
   *
   * It runs entirely in the browser, over the stock the menu endpoint ships. A round
   * trip per question would not be a walk, and the engine is `$lib/shared` — the same
   * functions on the same ingredients as the server, so the two cannot disagree.
   *
   * Only ever offers what the party can actually pour: the walk is intersected with
   * the pourable set, so it can never march someone to a drink that isn't on.
   */
  import {
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    OPTIONAL_CATEGORIES,
    categoryOf,
    countWith,
    makeable,
    reachable,
    type Category,
    type Recipe,
  } from '$lib/shared';

  let {
    stock,
    canOrder = true,
    onpick,
    onclose,
  }: {
    stock: string[];
    /** False when the party isn't taking orders — the walk still runs, it just can't add. */
    canOrder?: boolean;
    onpick: (recipe: Recipe) => void;
    onclose: () => void;
  } = $props();

  /** What this cupboard can pour. The walk never leaves this set. */
  const pourable = $derived(makeable(stock, { ignore: OPTIONAL_CATEGORIES }));
  const pourableIds = $derived(new Set(pourable.map((r) => r.id)));

  let base = $state<string | null>(null);
  let picked = $state<string[]>([]);
  let skipped = $state<Category[]>([]);

  /** Bases you could actually be poured, rather than all 25. */
  const offerableBases = $derived([...new Set(pourable.map((r) => r.base))].sort());

  const inPlay = $derived(
    reachable({ base, picked, skipped }).filter((r) => pourableIds.has(r.id)),
  );

  /**
   * The next question: the earliest category in the walk's order that some drink
   * still in play needs, and that hasn't been asked about yet.
   *
   * `method` is skipped — nobody chooses whether their drink is shaken, and the
   * ingredient list carries it only so the engine can model it.
   *
   * **Once one drink is left there is nothing to ask.** Its remaining ingredients
   * are not a choice, they are the recipe; asking "gin or dry vermouth?" of someone
   * who has already arrived at a Martini is a question with no wrong answer, which
   * is a question not worth putting.
   */
  const askable = $derived.by(() => {
    if (!base || inPlay.length <= 1) return null;
    for (const category of CATEGORY_ORDER) {
      if (category === 'method') continue;
      if (skipped.includes(category)) continue;
      const options = [
        ...new Set(
          inPlay.flatMap((r) =>
            r.ingredients.filter((i) => categoryOf(i) === category && !picked.includes(i)),
          ),
        ),
      ];
      // One option that every remaining drink needs isn't a choice, it's an
      // announcement — skip past it rather than asking a question with one answer.
      if (options.length === 0) continue;
      if (options.length === 1 && inPlay.every((r) => r.ingredients.includes(options[0]!)))
        continue;
      return {
        category,
        options: options.sort((a, b) => countWith(inPlay, b) - countWith(inPlay, a)),
      };
    }
    return null;
  });

  /**
   * The drink: nothing left to ask, and one thing left in play.
   *
   * The engine's `exactMatch()` is deliberately **not** what decides this. It asks
   * whether the picks *are* the ingredient list, and an ingredient list includes the
   * `method` — which this walk never asks about on purpose. Against a Negroni it
   * would compare two picks to three ingredients, decide the walk wasn't finished,
   * and offer "any of these: Negroni". Found by walking it.
   */
  const finished = $derived(base && !askable && inPlay.length === 1 ? inPlay[0]! : null);

  const restart = () => {
    base = null;
    picked = [];
    skipped = [];
  };
</script>

<section class="panel">
  <h2>Let's find you one</h2>

  {#if !base}
    <p>Start with a spirit. Only the ones tonight can actually pour are here.</p>
    <div class="suggests">
      {#each offerableBases as b (b)}
        <button class="btn" type="button" onclick={() => (base = b)}>{b}</button>
      {/each}
    </div>
    {#if offerableBases.length === 0}
      <p class="empty">Nothing is pourable tonight — ask whoever's behind the bar.</p>
    {/if}
  {:else if finished}
    <p><strong>{finished.name}</strong>{finished.blurb ? ` — ${finished.blurb}` : ''}</p>
    <!-- Still worth walking when the bar is shut: knowing what you'd have had is the
         friendly half of being told you can't have it. Only the adding is off. -->
    <button class="btn btn-go" type="button" disabled={!canOrder} onclick={() => onpick(finished)}>
      {canOrder ? 'Add it to my round' : 'The bar is not taking orders'}
    </button>
  {:else if askable}
    <p>{CATEGORY_LABELS[askable.category]}</p>
    <div class="suggests">
      {#each askable.options as option (option)}
        <!-- The badge is how many drinks survive picking it — the same "what does
             this unlock" the cupboard's suggestions carry, and the same styling. -->
        <button class="btn suggest" type="button" onclick={() => (picked = [...picked, option])}>
          {option}<b>{countWith(inPlay, option)}</b>
        </button>
      {/each}
      <button class="btn" type="button" onclick={() => (skipped = [...skipped, askable.category])}>
        No thanks
      </button>
    </div>
    <p class="empty">{inPlay.length} {inPlay.length === 1 ? 'drink' : 'drinks'} still in play.</p>
  {:else}
    <!-- Nothing left to ask and more than one drink standing: the picks describe
         several equally well, so show them rather than inventing another question. -->
    <p>{inPlay.length === 0 ? 'Nothing matches that combination.' : 'Any of these:'}</p>
    <div class="suggests">
      {#each inPlay.slice(0, 12) as r (r.id)}
        <button class="btn btn-go" type="button" disabled={!canOrder} onclick={() => onpick(r)}>
          {r.name}
        </button>
      {/each}
    </div>
  {/if}

  <div class="row-acts">
    {#if base}<button class="btn" type="button" onclick={restart}>Start again</button>{/if}
    <button class="btn" type="button" onclick={onclose}>Back to the menu</button>
  </div>
</section>
