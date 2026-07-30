/**
 * Favourite drinks, persisted. Lives here rather than inline in App.svelte so the
 * rule is uniform: persisted app state belongs in `lib/*.svelte.ts` and components
 * only render it.
 */
import { SvelteSet } from 'svelte/reactivity';
import { storage } from '$lib/storage';

const KEY = 'favs';

function load(): string[] {
  const stored = storage.readJSON<unknown>(KEY, []);
  return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : [];
}

// SvelteSet so add/delete are reactive — a plain Set in $state is not.
const names = new SvelteSet<string>(load());

export const favourites = {
  has: (name: string): boolean => names.has(name),
  get size(): number {
    return names.size;
  },
  toggle(name: string): void {
    if (names.has(name)) names.delete(name);
    else names.add(name);
    storage.writeJSON(KEY, [...names]);
  },
};
