import * as THREE from 'three';

/**
 * Real glassware, turned from a profile — and the colour of what's in it.
 *
 * The recipe data has carried `glass`, `ice`, `garnish` and `method` all along, and
 * the first pass at a 3D menu ignored every one of them to print a name on a box.
 * This is the correction: a Negroni is a rocks glass, stirred, one large cube,
 * orange peel, and all four of those are facts the app already holds.
 *
 * ## Lathes, not models
 *
 * A cocktail glass is a surface of revolution, so a 2D profile spun about Y is not an
 * approximation of one — it *is* one, exactly, for a few dozen vertices and no asset
 * pipeline. Nineteen glass names in the data collapse to six families; the rest are
 * variations of size that the same profile covers.
 */

/** Profiles in cm-ish units, read bottom to top: [radius, height]. */
type Profile = [number, number][];

const PROFILES: Record<string, { profile: Profile; fill: number }> = {
  // Wide, shallow bowl on a stem — the workhorse of the data set (96 drinks).
  coupe: {
    profile: [
      [0, 0],
      [1.5, 0.05],
      [1.55, 0.18],
      [0.22, 0.35],
      [0.18, 1.7],
      [0.5, 2.05],
      [1.85, 2.65],
      [2.15, 3.5],
      [2.2, 3.62],
    ],
    fill: 0.78,
  },
  // The cone. Same stem, straight sides.
  martini: {
    profile: [
      [0, 0],
      [1.55, 0.05],
      [1.6, 0.18],
      [0.22, 0.35],
      [0.18, 1.8],
      [0.35, 2.0],
      [2.5, 4.1],
      [2.55, 4.2],
    ],
    fill: 0.72,
  },
  // Short, heavy, straight — and the one that holds a single big cube.
  rocks: {
    profile: [
      [0, 0],
      [1.9, 0],
      [1.95, 0.35],
      [1.85, 2.6],
      [1.9, 2.72],
    ],
    fill: 0.55,
  },
  // Tall and straight. Collins is the same shape, taller.
  highball: {
    profile: [
      [0, 0],
      [1.5, 0],
      [1.55, 0.3],
      [1.5, 5.2],
      [1.55, 5.32],
    ],
    fill: 0.8,
  },
  // Narrow, tall bowl on a stem, for anything sparkling.
  flute: {
    profile: [
      [0, 0],
      [1.4, 0.05],
      [1.45, 0.16],
      [0.2, 0.32],
      [0.16, 1.9],
      [0.7, 2.3],
      [1.15, 3.6],
      [1.2, 5.0],
      [1.22, 5.1],
    ],
    fill: 0.82,
  },
  // Tiki mugs, copper mules, anything opaque and characterful.
  mug: {
    profile: [
      [0, 0],
      [1.75, 0],
      [1.8, 0.3],
      [1.7, 3.4],
      [1.9, 4.3],
      [1.95, 4.45],
    ],
    fill: 0.78,
  },
};

/**
 * Nineteen names in the data, six shapes on the shelf.
 *
 * Matched loosely and on purpose: the data contains `Rocks / tiki` and
 * `Highball / copa`, which are a bartender writing "either of these" rather than a
 * twentieth kind of glass.
 */
export function glassFamily(glass: string | undefined): keyof typeof PROFILES {
  const g = (glass ?? '').toLowerCase();
  if (g.includes('martini')) return 'martini';
  if (g.includes('coupe') || g.includes('sour') || g.includes('nick')) return 'coupe';
  if (g.includes('flute') || g.includes('champagne')) return 'flute';
  if (g.includes('mug') || g.includes('tiki')) return 'mug';
  if (g.includes('collins') || g.includes('highball') || g.includes('copa')) return 'highball';
  if (g.includes('rocks') || g.includes('old')) return 'rocks';
  // Wine, hurricane, punch and the long tail: a bowl on a stem is the safe default,
  // and it is what most of them are.
  return 'coupe';
}

/**
 * What colour is it?
 *
 * **Nothing in the data says.** A recipe knows its ingredients and its glass, never
 * its appearance — so this is the one part of the scene that is invented rather than
 * derived, and it is written as an explicit table so that it can be argued with.
 *
 * Read in order and first match wins, because a drink's colour comes from its
 * loudest ingredient: Campari beats gin, coffee liqueur beats vodka. Falling through
 * to the base spirit handles the two thirds of the list that are essentially clear.
 */
const TINTS: [RegExp, number][] = [
  [/campari|aperol|aperitivo|bitter/i, 0xf2360f],
  [/grenadine|cherry heering|cranberry/i, 0xc4113a],
  [/coffee|espresso|kahl|crème de cacao|chocolate/i, 0x3a1d10],
  [/midori|melon|chartreuse|crème de menthe|absinthe/i, 0x6fd21a],
  [/blue cura/i, 0x1b8ff0],
  [/red wine|port|sweet vermouth|amaro|averna/i, 0x7a1f14],
  [/pineapple|orange juice|mango|passion/i, 0xf59a12],
  [/tomato|clamato/i, 0xc0331a],
  [/cream|milk|coconut|horchata|egg white/i, 0xf3e6d0],
  [/cola|root beer|dark rum|aged rum|bourbon|rye|whisk/i, 0x9a5a1e],
  [/lemon|lime|grapefruit|elderflower|apple|white wine|prosecco|champagne/i, 0xe9dc84],
  [/cranberry|raspberry|strawberry|rose/i, 0xd5375f],
];

/** Base-spirit fallbacks, for a drink whose ingredients are all colourless. */
const BASE_TINTS: Record<string, number> = {
  Bourbon: 0x9a5a1e,
  Whiskey: 0x9a5a1e,
  Rye: 0xa2601f,
  Scotch: 0x8f5219,
  'Dark Rum': 0x7a441a,
  'Aged Rum': 0x8c5324,
  Brandy: 0x8c3f14,
  Cognac: 0x8c3f14,
  Tequila: 0xe8d79a,
  Mezcal: 0xe0cf95,
  Campari: 0xf2360f,
  Aperol: 0xf5651a,
  Prosecco: 0xefe3a8,
  Champagne: 0xefe3a8,
  Wine: 0x7a1f14,
  Beer: 0xd8a12a,
};

export function drinkTint(base: string, ingredients: string[] = []): THREE.Color {
  const haystack = ingredients.join(' ');
  for (const [pattern, hex] of TINTS) {
    if (pattern.test(haystack)) return new THREE.Color(hex);
  }
  if (BASE_TINTS[base]) return new THREE.Color(BASE_TINTS[base]);
  // Clear spirits with clear mixers: barely-there, so the glass does the work.
  return new THREE.Color(0xd8e8ea);
}

export interface Glassware {
  group: THREE.Group;
  /** Everything that owns GPU memory, for the caller's teardown. */
  disposables: { dispose(): void }[];
  /** Overall height, so the caller can sit it on a surface and aim a camera. */
  height: number;
}

/**
 * Build one drink: the vessel, what's in it, and its ice.
 *
 * `env` is required rather than optional. Transmission with nothing to refract
 * renders as flat grey — the material needs a world to bend, and passing it in makes
 * that a compile-time fact rather than something to discover on screen.
 */
export function makeGlass(
  family: keyof typeof PROFILES,
  tint: THREE.Color,
  ice: string | undefined,
  env: THREE.Texture,
): Glassware {
  const { profile, fill } = PROFILES[family]!;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const height = profile[profile.length - 1]![1];

  const shell = new THREE.LatheGeometry(points, 48);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1,
    thickness: 0.55,
    ior: 1.48,
    roughness: 0.04,
    metalness: 0,
    envMap: env,
    envMapIntensity: 1.5,
    // Both sides, or the far wall of the glass vanishes and it reads as a shell.
    side: THREE.DoubleSide,
    transparent: true,
  });
  // A mug is pottery or copper: opaque, and the drink inside is meant to be hidden.
  const mugMaterial = new THREE.MeshStandardMaterial({
    color: family === 'mug' ? 0xb87333 : 0xffffff,
    metalness: 0.85,
    roughness: 0.28,
    envMap: env,
  });
  const material = family === 'mug' ? mugMaterial : glassMaterial;
  disposables.push(shell, glassMaterial, mugMaterial);
  group.add(new THREE.Mesh(shell, material));

  // The liquid: the same profile, scaled in a shade and cut off at the fill line, so
  // it meets the glass wall instead of floating inside it.
  const surface = height * fill;
  const inner = points
    .filter((p) => p.y <= surface)
    .map((p) => new THREE.Vector2(Math.max(p.x * 0.93, 0), p.y));
  if (inner.length > 2) {
    inner.push(new THREE.Vector2(0, surface));
    const liquidGeometry = new THREE.LatheGeometry(inner, 48);
    const liquidMaterial = new THREE.MeshPhysicalMaterial({
      color: tint,
      transmission: 0.72,
      thickness: 1.6,
      ior: 1.36,
      roughness: 0.12,
      envMap: env,
      side: THREE.DoubleSide,
      transparent: true,
    });
    disposables.push(liquidGeometry, liquidMaterial);
    group.add(new THREE.Mesh(liquidGeometry, liquidMaterial));
  }

  // Ice, straight off the recipe. "One large cube" is a real instruction in this
  // data and the difference between it and crushed is the whole character of a
  // drink, so it is modelled rather than averaged into "some ice".
  const iceText = (ice ?? '').toLowerCase();
  const cubes = iceText.includes('large') ? 1 : iceText.includes('crush') ? 7 : iceText ? 3 : 0;
  if (cubes > 0) {
    const size = cubes === 1 ? 1.5 : cubes > 5 ? 0.5 : 0.9;
    const iceGeometry = new THREE.BoxGeometry(size, size, size, 2, 2, 2);
    const iceMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.92,
      thickness: 0.5,
      ior: 1.31,
      roughness: 0.32,
      envMap: env,
      transparent: true,
    });
    disposables.push(iceGeometry, iceMaterial);
    for (let i = 0; i < cubes; i++) {
      const cube = new THREE.Mesh(iceGeometry, iceMaterial);
      const spread = family === 'rocks' ? 0.5 : 0.35;
      // Deterministic scatter: a menu that reshuffles its ice on every reload reads
      // as noise. Trig on the index gives an arrangement that looks tumbled and is
      // the same every time.
      cube.position.set(
        Math.sin(i * 2.4) * spread,
        surface * 0.55 + (i % 3) * size * 0.55,
        Math.cos(i * 1.7) * spread,
      );
      cube.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      group.add(cube);
    }
  }

  return { group, disposables, height };
}
