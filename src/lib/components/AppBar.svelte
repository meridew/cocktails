<script lang="ts">
  /**
   * The top of every screen, with one grammar.
   *
   * ## What it replaces
   *
   * Seven screens each hand-rolled this row, and the **same corner meant six
   * different things**: a key glyph on the front door, settings-then-bar on the menu,
   * options-then-leave on the bar, "Back" on a host's party, "Flat menu" on the 3D
   * one — and **Sign out** on `/host` and `/admin`. Those last two are the tell. In a
   * host's own two screens, one tap apart, the same corner was Sign out on one and
   * Back on the other. No muscle memory can survive that, and the failure mode is
   * losing your session reaching for Back.
   *
   * ## The grammar
   *
   * - **Left is always up.** A real `<a href>` to the parent, never `history.back()` —
   *   so it works on a cold load into a deep link, where there is no history to go
   *   back through. At a root there is no up, and the brand takes the slot.
   * - **Centre is always where you are.** The party's name, or the section's.
   * - **Right is always ⚙️**, optionally preceded by this screen's one action.
   *   **Never sign out.** Signing out moved into Settings, which is mounted in the
   *   root layout and therefore reachable from every screen in the app — which is
   *   more places than it was available from before, not fewer.
   *
   * The three body wrappers (`.workshell`, `.app`, `.bartender`) are deliberately
   * left alone. They are a scrolling column, a three-row grid with a tab bar, and a
   * fixed full-screen overlay; merging them would be a large layout change with no
   * navigational payoff. What was wrong was the *grammar of the controls*, and that
   * is what this owns.
   */
  import type { Snippet } from 'svelte';
  import { settings } from '$lib/stores/view.svelte';

  let {
    up,
    title,
    brand = false,
    action,
  }: {
    /** Where "up" goes, and what to call it. Omit at a root. */
    up?: { href: string; label: string };
    /** Where you are. Omitted only when `brand` stands in for it. */
    title?: string;
    /** Show the wordmark instead of a title — the front door and the guest menu. */
    brand?: boolean;
    /** This screen's one action, rendered to the left of Settings. */
    action?: Snippet;
  } = $props();
</script>

<header class="appbar">
  {#if up}
    <!-- A link, not a button calling `history.back()`. Someone who opened this URL
         from a notification, a QR code or a shared message has no history behind
         them, and a back button that does nothing is worse than no back button. -->
    <a class="appbar-up" href={up.href}>
      <span class="appbar-up-chev" aria-hidden="true">←</span>
      <span class="appbar-up-label">{up.label}</span>
    </a>
  {:else if brand}
    <span class="brand">COCKTAILS</span>
  {/if}

  {#if title}
    <h1 class="appbar-title" class:has-up={Boolean(up)}>{title}</h1>
  {/if}

  <div class="appbar-actions">
    {@render action?.()}
    <button
      type="button"
      class="appbar-bartender"
      onclick={() => (settings.open = true)}
      aria-label="Settings"
    >
      <span class="emoji">⚙️</span>
    </button>
  </div>
</header>
