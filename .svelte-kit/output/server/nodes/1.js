export const index = 1;
let component_cache;
export const component = async () =>
  (component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default);
export const imports = [
  '_app/immutable/nodes/1.B2IYMsk6.js',
  '_app/immutable/chunks/C7ZFKefg.js',
  '_app/immutable/chunks/BoyJjPm4.js',
  '_app/immutable/chunks/CSlEPxhp.js',
  '_app/immutable/chunks/CdqB6jFE.js',
  '_app/immutable/chunks/BoLmkAbQ.js',
];
export const stylesheets = [];
export const fonts = [];
