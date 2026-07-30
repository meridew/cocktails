

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/layout.svelte.js')).default;
export const imports = ["_app/immutable/nodes/0.llTgyxyi.js","_app/immutable/chunks/C7ZFKefg.js","_app/immutable/chunks/BoyJjPm4.js","_app/immutable/chunks/CtkE3022.js"];
export const stylesheets = [];
export const fonts = [];
