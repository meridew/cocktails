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
   *
   * ## It will not throw your work away any more
   *
   * **"Done" used to discard.** It calls `onclose`, which unmounts the editor — and
   * on the short list the Save button scrolled off screen after the first flick, so
   * the only control left in view was the one that lost forty ticks. Reported as
   * "it is too easy to change drink selection and navigate away losing changes",
   * which is exactly what the header offered.
   *
   * So the sheet now asks the editor whether it has unsaved work (see
   * `$lib/worksheet`) and, when it has, does four things: relabels the header to
   * **Save and close**, keeps a quiet **Discard** beside it, confirms on Escape, and
   * guards *leaving the page* — Back, the phone's back gesture, an in-app link, or
   * closing the tab. Nothing in this app guarded any of those before.
   *
   * Staying not-a-route is what makes that last part necessary rather than free: Back
   * does not close the sheet, it leaves `/admin/p/<id>` altogether.
   */
  import type { Snippet } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { dialog } from '$lib/dialog';
  import { provideWorkSheet, type SheetEditor } from '$lib/worksheet';

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

  /** Filled in by whatever is rendered inside, if it has anything to lose. */
  let editor = $state<SheetEditor | null>(null);
  provideWorkSheet((e) => (editor = e));

  // Called, not read: see `SheetEditor.isDirty`. This is what tracks the child's rune.
  const dirty = $derived(editor?.isDirty() ?? false);
  let saving = $state(false);

  /** One sentence, used by all three exits, so they cannot drift apart. */
  const ASK = 'You have unsaved changes. Leave without saving?';

  /** Escape and Discard both come through here. Silent when there is nothing to lose. */
  function tryClose(): void {
    if (!dirty || confirm(ASK)) onclose();
  }

  async function saveAndClose(): Promise<void> {
    if (!editor || saving) return;
    saving = true;
    try {
      // Only close if it actually stuck. A failed save leaves the sheet open with the
      // editor's own error showing, rather than closing over the top of it.
      if (await editor.save()) onclose();
    } finally {
      saving = false;
    }
  }

  /**
   * Leaving the *page*, which closing the sheet is not.
   *
   * Covers Back, the phone's back gesture and any in-app link. `cancel()` keeps them
   * where they are; the sheet is still open and still holding the work.
   */
  beforeNavigate((nav) => {
    if (dirty && !confirm(ASK)) nav.cancel();
  });
</script>

<!--
  Closing the tab or reloading. The browser shows its own wording and ignores ours —
  `preventDefault` is the whole of the modern API — so there is nothing to phrase
  here. It is best-effort by design: some mobile browsers skip it entirely, which is
  why it is the last of four guards rather than the only one.
-->
<svelte:window
  onbeforeunload={(e) => {
    if (dirty) e.preventDefault();
  }}
/>

<div
  class="worksheet"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  use:dialog={{ onclose: tryClose }}
>
  <div class="worksheet-card">
    <header class="worksheet-head">
      <div class="worksheet-title">
        <h2>{title}</h2>
        {#if subtitle}<p class="row-note">{subtitle}</p>{/if}
      </div>
      {#if dirty}
        <!-- Two buttons only while there is a real choice to make. When nothing is
             unsaved this is one button that means one thing, as it always was. -->
        <div class="worksheet-acts">
          <button class="btn btn-go" type="button" disabled={saving} onclick={saveAndClose}>
            {saving ? 'Saving…' : 'Save and close'}
          </button>
          <button class="btn btn-quiet" type="button" disabled={saving} onclick={tryClose}>
            Discard
          </button>
        </div>
      {:else}
        <button class="btn worksheet-done" type="button" onclick={onclose}>Done</button>
      {/if}
    </header>
    <div class="worksheet-body">
      {@render children()}
    </div>
  </div>
</div>
