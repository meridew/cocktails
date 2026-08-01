import { getContext, setContext } from 'svelte';

/**
 * What a [WorkSheet] needs to know about the editor inside it.
 *
 * **`isDirty` is a getter, not a boolean.** The sheet reads it inside a `$derived`,
 * so the call has to happen at read time for the child's own rune to be tracked;
 * passing the value would freeze it at whatever it was when the child mounted, which
 * is always `false`.
 */
export interface SheetEditor {
  isDirty: () => boolean;
  /** Commit. Resolves `true` only if it actually stuck — the sheet stays open on `false`. */
  save: () => Promise<boolean>;
}

interface Registry {
  register: (editor: SheetEditor) => void;
}

const KEY = Symbol('worksheet');

/**
 * Why context and not props.
 *
 * "Am I dirty" is known only by the editor, and "may I close" only by the sheet —
 * but the two are never siblings in a page, they are container and content. Threading
 * `dirty` and `save` up through four call sites (`/host/[id]`, `/admin/p/[id]`, twice
 * each) would mean four pages holding state about a job none of them do, and a
 * `bind:` to a *function* to go with it.
 *
 * So the sheet offers a slot and the editor fills it, and `<WorkSheet><ShortList/>`
 * stays exactly as it reads today.
 */
export const provideWorkSheet = (register: Registry['register']): void => {
  setContext<Registry>(KEY, { register });
};

/**
 * Tell the surrounding sheet how to ask about unsaved work.
 *
 * Safe outside a sheet: an editor rendered on a plain page simply has nobody to tell,
 * and keeps its own Save button as its only route out.
 */
export const registerSheetEditor = (editor: SheetEditor): void => {
  getContext<Registry | undefined>(KEY)?.register(editor);
};
