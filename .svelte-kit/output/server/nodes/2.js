export const index = 2;
let component_cache;
export const component = async () =>
  (component_cache ??= (await import('../entries/pages/_page.svelte.js')).default);
export const imports = [
  '_app/immutable/nodes/2.DfzFS_mY.js',
  '_app/immutable/chunks/C7ZFKefg.js',
  '_app/immutable/chunks/BoyJjPm4.js',
];
export const stylesheets = [];
export const fonts = [];
