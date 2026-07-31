import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RECIPES } from '$lib/shared';
import type { MenuItem } from '$lib/api';
import { drinkTint, glassFamily, makeGlass } from './glassware';

/**
 * The menu, as the drinks themselves, turning on a bar.
 *
 * The first version of this file put drink names on coloured boxes and threw away
 * everything else the data holds. A recipe knows its glassware, its ice, its garnish
 * and its method — so a Negroni is a rocks glass, stirred, one large cube, orange
 * peel, and rendering it as a card was throwing away the only thing 3D is actually
 * good for.
 *
 * ## What makes it look like glass
 *
 * Three things, and all three are needed — any two look wrong:
 *
 * - **Transmission**, so light passes through and bends rather than bouncing off.
 * - **An environment to bend.** `MeshPhysicalMaterial` with transmission and nothing
 *   around it renders as flat grey; the room built here is what appears in the
 *   curve of every glass.
 * - **Bloom.** The palette is neon, and neon that doesn't bleed is just bright paint.
 *
 * ## Cost, and how it is kept down
 *
 * Transmission is expensive and this is a guest's phone at a party. Three things
 * hold it: the pixel ratio is capped, the environment is generated once and shared
 * by every material, and only the near arc is drawn — the rest of the ring has its
 * `visible` flag off, so sixty drinks cost about eight.
 */

const PALETTE = { bg: 0xffe600, ink: 0x0a0a12 } as const;

/** Roughly how much room a drink needs on the bar, in the glassware's own units. */
const SPACING = 6.2;
/** How many are drawn at once. The rest are behind you and cost nothing. */
const VISIBLE_ARC = 9;

export interface Rack {
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface RackOptions {
  /** Fired when a different drink comes to the front, so the page can name it. */
  onFocus?: (item: MenuItem) => void;
}

export function createRack(
  canvas: HTMLCanvasElement,
  items: MenuItem[],
  options: RackOptions = {},
): Rack {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.Fog(PALETTE.bg, 30, 130);

  /*
   * The world the glass refracts.
   *
   * `RoomEnvironment` is a box of emissive panels — a photographer's lightbox — and
   * pushing it through `PMREMGenerator` turns it into the pre-filtered map a physical
   * material samples. It never appears on screen directly. Without it every glass in
   * this scene is a grey silhouette, which is the single biggest difference between
   * "3D drink" and "3D object shaped like a drink".
   */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);

  const radius = Math.max(9, (items.length * SPACING) / (Math.PI * 2));
  const ring = new THREE.Group();
  scene.add(ring);

  const disposables: { dispose(): void }[] = [];
  const drinks: { mesh: THREE.Object3D; item: MenuItem; angle: number }[] = [];

  items.forEach((item, i) => {
    // The full recipe, not the menu row: `MenuItem` is what a guest's list needs,
    // and the ice and the ingredient list live one lookup away in the same bundle
    // the walk already uses. No API change to get them.
    const recipe = RECIPES.find((r) => r.id === item.id);
    const {
      group,
      disposables: owned,
      height,
    } = makeGlass(
      glassFamily(item.glass ?? recipe?.glass),
      drinkTint(item.base, recipe?.ingredients ?? []),
      recipe?.ice,
      env,
    );
    disposables.push(...owned);

    const angle = (i / items.length) * Math.PI * 2;
    group.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    // Face outward, so the near arc is looking at the camera.
    group.rotation.y = angle;
    // Everything sits on the bar rather than at its own origin, whatever its height.
    group.userData.height = height;
    ring.add(group);
    drinks.push({ mesh: group, item, angle });
  });

  /*
   * The bar top.
   *
   * Dark and polished rather than the acid floor the flat design uses: glass needs
   * something to sit *in*, and a mirrored surface under a drink is half of why a
   * photograph of one looks like anything. The yellow stays as the room behind it.
   */
  const barGeometry = new THREE.CircleGeometry(radius + 24, 96);
  const barMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.ink,
    roughness: 0.14,
    metalness: 0.65,
    envMap: env,
    envMapIntensity: 0.9,
  });
  disposables.push(barGeometry, barMaterial);
  const bar = new THREE.Mesh(barGeometry, barMaterial);
  bar.rotation.x = -Math.PI / 2;
  scene.add(bar);

  /*
   * One hard key light, still.
   *
   * The flat design's signature is a single unsoftened shadow, and that survives the
   * translation — the environment does the *reflections*, this does the *drama*. A
   * second fill would round everything off into a product render.
   */
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-14, 22, 12);
  scene.add(key);
  // A cyan and a pink bounce, low and either side, so the neon is in the glass
  // rather than only in the background.
  const cyan = new THREE.PointLight(0x00e5ff, 260, 90);
  cyan.position.set(-radius * 0.6, 4, radius * 0.5);
  const pink = new THREE.PointLight(0xff2e88, 260, 90);
  pink.position.set(radius * 0.6, 4, radius * 0.5);
  scene.add(cyan, pink);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Threshold high enough that the yellow room doesn't bloom — only the lights and
  // the highlights on the glass rims should, or the whole screen turns to soup.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.9, 0.92);
  composer.addPass(bloom);

  let frame = 0;
  let stopped = false;
  let focused = -1;
  const clock = new THREE.Clock();

  function tick() {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    ring.rotation.y += clock.getDelta() * 0.11;

    // Draw only the near arc. Everything else is behind the camera or lost in fog,
    // and transmission is far too expensive to spend on drinks nobody can see.
    const turn = ring.rotation.y;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < drinks.length; i++) {
      const d = drinks[i]!;
      // Angle from the camera's side of the ring, wrapped to ±π.
      let delta = ((d.angle + turn) % (Math.PI * 2)) + Math.PI * 2;
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
      const away = Math.abs(delta);
      d.mesh.visible = away < (Math.PI * VISIBLE_ARC) / drinks.length + 0.35;
      if (away < best) {
        best = away;
        nearest = i;
      }
    }
    if (nearest !== focused) {
      focused = nearest;
      options.onFocus?.(drinks[nearest]!.item);
    }

    composer.render();
  }
  tick();

  return {
    resize(width, height) {
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloom.setSize(width, height);
      camera.aspect = width / height;

      /*
       * Frame a fixed number of drinks, whatever the screen.
       *
       * Derived rather than guessed: the first version had two hand-tuned distances
       * and put one and a half objects on a phone. Work out how wide the near arc
       * needs to be, convert that to the frustum height the aspect implies, and the
       * distance falls out of the field of view.
       */
      const want = camera.aspect < 0.8 ? 2.2 : 4;
      const needWidth = want * SPACING;
      const needHeight = needWidth / camera.aspect;
      const back = needHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      camera.position.set(0, 4.2, radius + Math.max(back, 8));
      camera.lookAt(0, 2.4, radius * 0.1);
      camera.updateProjectionMatrix();
    },
    dispose() {
      stopped = true;
      cancelAnimationFrame(frame);
      for (const d of disposables) d.dispose();
      env.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
