<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getAlcoholProfile,
    saveAlcoholProfile,
    Unauthorized,
    type AlcoholProfileView,
  } from '$lib/api';
  import { registerSheetEditor } from '$lib/worksheet';
  import type { AlcoholOverrides } from '$lib/shared';

  let {
    userId,
    onsaved,
  }: {
    userId: string;
    onsaved?: () => void;
  } = $props();

  let profile = $state<AlcoholProfileView | null>(null);
  let abv = $state<Record<string, string>>({});
  let volumes = $state<Record<string, Record<string, string>>>({});
  let saved = $state('');
  let tab = $state<'bottles' | 'pours'>('bottles');
  let filter = $state('');
  let busy = $state(false);
  let error = $state('');

  const payload = $derived.by<AlcoholOverrides>(() => ({
    abv: Object.fromEntries(
      Object.entries(abv)
        .filter(([, value]) => value.trim() !== '')
        .map(([ingredient, value]) => [ingredient, Number(value)]),
    ),
    volumes: Object.fromEntries(
      Object.entries(volumes)
        .map(([recipeId, components]) => [
          recipeId,
          Object.fromEntries(
            Object.entries(components)
              .filter(([, value]) => value.trim() !== '')
              .map(([ingredient, value]) => [ingredient, Number(value)]),
          ),
        ])
        .filter(([, components]) => Object.keys(components as Record<string, number>).length > 0),
    ),
  }));
  const dirty = $derived(saved !== '' && JSON.stringify(payload) !== saved);
  const stocked = $derived(
    (profile?.ingredients ?? []).filter(
      (ingredient) =>
        ingredient.inStock &&
        ingredient.ingredient.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  );
  const recipes = $derived(
    (profile?.recipes ?? []).filter(
      (recipe) =>
        recipe.makeable &&
        (recipe.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
          recipe.components.some((component) =>
            component.ingredient.toLowerCase().includes(filter.trim().toLowerCase()),
          )),
    ),
  );

  function adopt(view: AlcoholProfileView): void {
    profile = view;
    abv = Object.fromEntries(
      Object.entries(view.overrides.abv).map(([ingredient, value]) => [ingredient, String(value)]),
    );
    volumes = Object.fromEntries(
      Object.entries(view.overrides.volumes).map(([recipeId, components]) => [
        recipeId,
        Object.fromEntries(
          Object.entries(components).map(([ingredient, value]) => [ingredient, String(value)]),
        ),
      ]),
    );
    saved = JSON.stringify({
      abv: view.overrides.abv,
      volumes: view.overrides.volumes,
    });
  }

  async function load(): Promise<void> {
    error = '';
    try {
      const { ok: _ok, ...view } = await getAlcoholProfile(userId);
      adopt(view);
    } catch (cause) {
      if (!(cause instanceof Unauthorized)) {
        error = (cause as Error).message || "Couldn't load unit assumptions";
      }
    }
  }

  async function save(): Promise<boolean> {
    if (busy) return false;
    busy = true;
    error = '';
    try {
      const { ok: _ok, ...view } = await saveAlcoholProfile(userId, payload);
      adopt(view);
      onsaved?.();
      return true;
    } catch (cause) {
      if (!(cause instanceof Unauthorized)) {
        error = (cause as Error).message || "That didn't save";
      }
      return false;
    } finally {
      busy = false;
    }
  }

  function setAbv(ingredient: string, value: string): void {
    abv[ingredient] = value;
  }

  function resetAbv(ingredient: string): void {
    delete abv[ingredient];
  }

  function setVolume(recipeId: string, ingredient: string, value: string): void {
    volumes[recipeId] ??= {};
    volumes[recipeId]![ingredient] = value;
  }

  function resetVolume(recipeId: string, ingredient: string): void {
    if (!volumes[recipeId]) return;
    delete volumes[recipeId]![ingredient];
    if (Object.keys(volumes[recipeId]!).length === 0) delete volumes[recipeId];
  }

  registerSheetEditor({ isDirty: () => dirty, save });
  onMount(load);
</script>

<div class="alcohol-profile">
  {#if error}<p class="says says-bad" role="status">{error}</p>{/if}

  {#if !profile}
    <p class="empty">Loading...</p>
  {:else}
    <div class="panel-acts acts-sticky">
      <p class="stat">
        <b
          >{Object.keys(payload.abv).length +
            Object.values(payload.volumes).reduce((n, row) => n + Object.keys(row).length, 0)}</b
        >
        custom {Object.keys(payload.abv).length === 1 ? 'setting' : 'settings'}
      </p>
      <button class="btn btn-go" type="button" disabled={!dirty || busy} onclick={save}>
        {busy ? 'Saving...' : dirty ? 'Save' : 'Saved'}
      </button>
    </div>

    <section class="panel profile-controls">
      <nav class="bar-tabs" aria-label="Unit assumptions">
        <button
          class="bar-tab"
          type="button"
          aria-current={tab === 'bottles'}
          onclick={() => (tab = 'bottles')}
        >
          Bottle strengths <b>{profile.ingredients.filter((item) => item.inStock).length}</b>
        </button>
        <button
          class="bar-tab"
          type="button"
          aria-current={tab === 'pours'}
          onclick={() => (tab = 'pours')}
        >
          Recipe pours <b>{profile.recipes.filter((recipe) => recipe.makeable).length}</b>
        </button>
      </nav>
      <label class="field">
        Search
        <input type="search" bind:value={filter} placeholder="Gin, Martini..." autocomplete="off" />
      </label>
    </section>

    {#if tab === 'bottles'}
      <section class="panel">
        <h2>Stocked bottles</h2>
        <p class="row-note">
          Use the strength printed on the bottle. Defaults remain until changed.
        </p>
        <div class="profile-list">
          {#each stocked as ingredient (ingredient.ingredient)}
            <div class="profile-row">
              <span class="profile-name">
                <b>{ingredient.ingredient}</b>
                <small>{ingredient.source} · default {ingredient.defaultAbv}%</small>
              </span>
              <label>
                <span class="sr-only">{ingredient.ingredient} ABV</span>
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={abv[ingredient.ingredient] ?? ''}
                  placeholder={String(ingredient.defaultAbv)}
                  oninput={(event) => setAbv(ingredient.ingredient, event.currentTarget.value)}
                />
                <span>% ABV</span>
              </label>
              <button
                class="btn btn-quiet"
                type="button"
                disabled={abv[ingredient.ingredient] === undefined}
                onclick={() => resetAbv(ingredient.ingredient)}>Reset</button
              >
            </div>
          {:else}
            <p class="empty">No stocked alcoholic ingredients match this search.</p>
          {/each}
        </div>
      </section>
    {:else}
      <section class="panel">
        <h2>Makeable recipe pours</h2>
        <p class="row-note">Set the measured alcoholic pour used by the bar for each serving.</p>
        <div class="recipe-list">
          {#each recipes as recipe (recipe.id)}
            <div class="recipe-row">
              <h3>{recipe.name}</h3>
              {#each recipe.components as component (component.ingredient)}
                <div class="component-row">
                  <span>{component.ingredient}</span>
                  <label>
                    <span class="sr-only">{component.ingredient} in {recipe.name}</span>
                    <input
                      type="number"
                      min="0.1"
                      max="2000"
                      step="0.5"
                      value={volumes[recipe.id]?.[component.ingredient] ?? ''}
                      placeholder={String(component.defaultVolumeMl)}
                      oninput={(event) =>
                        setVolume(recipe.id, component.ingredient, event.currentTarget.value)}
                    />
                    <span>ml</span>
                  </label>
                  <button
                    class="btn btn-quiet"
                    type="button"
                    disabled={volumes[recipe.id]?.[component.ingredient] === undefined}
                    onclick={() => resetVolume(recipe.id, component.ingredient)}>Reset</button
                  >
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty">No makeable alcoholic recipes match this search.</p>
          {/each}
        </div>
      </section>
    {/if}

    <p class="profile-note">
      Changes apply to future orders only. Existing party figures keep the assumptions recorded when
      each order was placed.
    </p>
  {/if}
</div>

<style>
  .alcohol-profile {
    display: grid;
    gap: 14px;
  }
  .profile-controls {
    display: grid;
    gap: 14px;
  }
  .bar-tabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }
  .profile-list,
  .recipe-list {
    display: grid;
  }
  .profile-row {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) auto 72px;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
  }
  .profile-name {
    display: grid;
    min-width: 0;
  }
  .profile-name small {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .profile-row label,
  .component-row label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 800;
    white-space: nowrap;
  }
  .profile-row input,
  .component-row input {
    width: 82px;
    min-height: 42px;
    border: 3px solid var(--ink);
    padding: 5px 7px;
    font: inherit;
  }
  .recipe-row {
    padding: 12px 0;
    border-bottom: 2px solid var(--ink);
  }
  .recipe-row h3 {
    margin: 0 0 5px;
    font-size: 1rem;
  }
  .component-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) auto 72px;
    gap: 10px;
    align-items: center;
    padding: 5px 0;
  }
  .profile-note {
    font-size: 0.82rem;
    font-weight: 700;
    text-align: center;
  }
  @media (max-width: 560px) {
    .profile-row,
    .component-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .profile-row .profile-name,
    .recipe-row h3 {
      grid-column: 1 / -1;
    }
    .profile-row .btn,
    .component-row .btn {
      min-width: 64px;
    }
  }
</style>
