<script lang="ts">
  /**
   * A full-screen surface for a job that is too big to sit in a list.
   *
   * **This exists because two of them were sitting in lists.** The cupboard rendered
   * inline on the admin screen measured 7,859px — 175 checkboxes under 13 headings —
   * inside a panel headed "Their cupboard", which pushed "Their parties" and "The
   * account" about nine screens below the fold with nothing to say they were still
   * there. The short list did the same thing one level worse: it expanded *between* a
   * party row and the form for creating a party, so the reading order was a party, a
   * 33-drink menu editor, and a new-party form, all under one heading.
   *
   * The rule this encodes: a panel may state a fact and offer a way in. It may not
   * *become* the thing it is describing. Anything that needs a search box and its own
   * headings is a screen, not a panel.
   *
   * Deliberately not a route. `Configurator`, `SettingsSheet` and the order rail all
   * already do full-screen-over-content, so this is the house idiom rather than a new
   * one — and staying on the page is what keeps "look at their cupboard, then open
   * their party" one context instead of a navigation each way.
   */
  import type { Snippet } from 'svelte';
  import { dialog } from '$lib/dialog';

  let {
    title,
    subtitle,
    onclose,
    children,
  }: {
    title: string;
    /** The thing this is *about* — whose cupboard, which party. */
    subtitle?: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  /*
   * No scroll lock here on purpose.
   *
   * The obvious `document.body.style.overflow = 'hidden'` is a no-op in this app:
   * neo.css already pins the shell with `body { overflow: hidden }` and scrolls
   * `.deck` instead, so setting it does nothing and restoring it on close restores
   * it to the same value. What actually needs holding is scroll *chaining* — a flick
   * that runs out of sheet would otherwise carry on into the deck behind it — and
   * that is `overscroll-behavior: contain` on `.worksheet-body`, in CSS.
   *
   * Modal behaviour, on the other hand, is `use:dialog` below and not written here.
   * The first version of this file hand-rolled an Escape handler on `svelte:window`
   * and stopped there — no focus trap, no inert background, no focus returned to the
   * button that opened it — while seven other overlays in this app were already
   * using the shared action that does all four. That is the actual lesson about
   * frameworks: the primitive existed and was good, and a new overlay quietly
   * shipped without it.
   */
</script>

<div
  class="worksheet"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  use:dialog={{ onclose }}
>
  <div class="worksheet-card">
    <header class="worksheet-head">
      <div class="worksheet-title">
        <h2>{title}</h2>
        {#if subtitle}<p class="row-note">{subtitle}</p>{/if}
      </div>
      <button class="btn worksheet-done" type="button" onclick={onclose}>Done</button>
    </header>
    <div class="worksheet-body">
      {@render children()}
    </div>
  </div>
</div>
