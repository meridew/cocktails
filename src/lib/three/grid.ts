import * as THREE from 'three';
import type { MenuItem } from '$lib/api';

/**
 * The menu you already have, given thickness.
 *
 * Two earlier attempts at a 3D menu both replaced the layout with a carousel, which
 * was my idea rather than the product's — and a guest who knows the flat menu should
 * recognise this one instantly. So: the same grid, the same two columns on a phone,
 * the same cards in the same order. What changes is that they are objects. They have
 * depth, they sit at slightly different distances, one hard light throws a real
 * version of the shadow the flat design paints on, and the whole wall leans as you
 * scroll past it.
 *
 * ## What stays in the DOM
 *
 * Everything that takes input beyond a tap. The chips, the round, the name, the send
 * button: text entry inside WebGL means reimplementing a keyboard, focus, autofill
 * and a screen reader, and losing to the ones the phone already has. The scene is
 * the menu; the page is still the app.
 */

const CARD_W = 3;
const CARD_H = 3.9;
const CARD_D = 0.34;
const GAP = 0.55;

/** `neo.css`'s `:root`, which does not survive into a WebGL context. */
const INK = 0x0a0a12;
const BG = 0xffe600;
const CARD_COLOURS = [0x00e5ff, 0xacff00, 0xff2e88];
const ACCENT = 0xff2e88;

export interface Grid {
  resize(width: number, height: number): void;
  /** Which drinks to show. Re-lays out in place, for the faves filter. */
  setItems(items: MenuItem[]): void;
  dispose(): void;
}

export interface GridOptions {
  /** A card was tapped. The page decides what that means — sheet, or straight in. */
  onPick?: (item: MenuItem) => void;
  /** Fired when the tapped card has finished its pop, so the page can flash a badge. */
  onAdded?: (item: MenuItem) => void;
}

/**
 * One card's face, drawn with the real fonts.
 *
 * Canvas rather than a text shader: the design is a specific poster face at a
 * specific tracking, the browser has already loaded it for the flat menu, and
 * `ctx.font` gets exactly that for nothing. Re-implementing wrapping and tracking in
 * GLSL would get close and never right.
 */
function faceTexture(item: MenuItem, colour: number, emoji: string, added: boolean): THREE.Texture {
  const W = 480;
  const H = Math.round((W * CARD_H) / CARD_W);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

  ctx.fillStyle = hex(colour);
  ctx.fillRect(0, 0, W, H);

  ctx.font = '54px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(emoji, 34, 30);

  // Shrink to fit rather than truncate: "Improved Holland Gin Cocktail" is a real
  // entry, and a menu that renders it clipped has failed at its only job.
  const words = item.name.toUpperCase().split(/\s+/);
  ctx.fillStyle = hex(INK);
  let size = 46;
  let lines: string[] = [];
  for (; size > 20; size -= 2) {
    ctx.font = `${size}px "Archivo Black", system-ui, sans-serif`;
    lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= W - 68) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length * size * 1.14 <= 190) break;
  }
  lines.forEach((l, i) => ctx.fillText(l, 34, 108 + i * size * 1.14));

  // The card's own call to action, drawn where the flat one puts it — this is what
  // makes a tap obviously a tap rather than a guess.
  const btnY = H - 118;
  ctx.fillStyle = added ? hex(ACCENT) : hex(INK);
  ctx.beginPath();
  ctx.roundRect(34, btnY, W - 68, 82, 16);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '25px "Bungee", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(added ? '✓ ADDED' : 'ADD TO ORDER', W / 2, btnY + 28);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

interface Card {
  mesh: THREE.Mesh;
  item: MenuItem;
  /** Rest position, so the pop animation has something to return to. */
  home: THREE.Vector3;
  pop: number;
  face: THREE.MeshStandardMaterial;
  emoji: string;
}

export function createGrid(
  canvas: HTMLCanvasElement,
  emojiFor: (item: MenuItem) => string,
  options: GridOptions = {},
): Grid {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const wall = new THREE.Group();
  scene.add(wall);

  // The surface the cards throw their shadow onto — the acid yellow, set back far
  // enough that the shadow reads as a gap rather than as a smudge.
  const backGeo = new THREE.PlaneGeometry(400, 400);
  const backMat = new THREE.MeshStandardMaterial({ color: BG, roughness: 1 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.z = -2.4;
  back.receiveShadow = true;
  scene.add(back);

  /*
   * One hard key light, low-left.
   *
   * The flat design's signature is a single unsoftened offset shadow. This is that
   * light, made real — which is the whole argument for doing this in 3D rather than
   * with a filter.
   */
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-9, 12, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 26, bottom: -26, far: 70 });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 1.25));

  const edge = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.8 });
  const geometry = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D);

  let cards: Card[] = [];
  let columns = 2;
  let items: MenuItem[] = [];

  /** How far the wall has been scrolled, and where it is heading. */
  let scroll = 0;
  let target = 0;
  let maxScroll = 0;

  function clearCards() {
    for (const c of cards) {
      wall.remove(c.mesh);
      c.face.map?.dispose();
      c.face.dispose();
    }
    cards = [];
  }

  function layout() {
    clearCards();
    items.forEach((item, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const face = new THREE.MeshStandardMaterial({
        map: faceTexture(item, CARD_COLOURS[i % CARD_COLOURS.length]!, emojiFor(item), false),
        roughness: 0.7,
      });
      // Box materials are +x,-x,+y,-y,+z,-z: the printed face is +z and every other
      // side is ink, which gives the slab its black outline from any angle without a
      // second mesh.
      const mesh = new THREE.Mesh(geometry, [edge, edge, edge, edge, face, edge]);
      mesh.castShadow = true;

      const x = (col - (columns - 1) / 2) * (CARD_W + GAP);
      const y = -row * (CARD_H + GAP);
      // A little depth variance so the wall has relief rather than reading as one
      // flat sheet — deterministic, because a grid that reshuffles on reload is noise.
      const z = ((i * 37) % 5) * 0.09;
      mesh.position.set(x, y, z);
      mesh.userData.index = i;
      wall.add(mesh);
      cards.push({ mesh, item, home: mesh.position.clone(), pop: 0, face, emoji: emojiFor(item) });
    });

    const rows = Math.ceil(items.length / columns);
    maxScroll = Math.max(0, (rows - 1) * (CARD_H + GAP));
    target = Math.min(target, maxScroll);
  }

  // ---- input ---------------------------------------------------------------
  // Scrolling is the wall moving, not the camera: it keeps the light and the
  // shadow fixed relative to the viewer, which is what the flat design does.

  let dragging = false;
  let lastY = 0;
  let moved = 0;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  const unitsPerPixel = () => 0.012;

  function onDown(e: PointerEvent) {
    dragging = true;
    moved = 0;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - lastY;
    lastY = e.clientY;
    moved += Math.abs(dy);
    target = Math.min(Math.max(target - dy * unitsPerPixel(), 0), maxScroll);
  }
  function onUp(e: PointerEvent) {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
    // A drag is not a tap. Without this threshold every scroll ends by ordering
    // whatever happened to be under your thumb.
    if (moved > 8) return;

    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(wall.children, false)[0];
    if (!hit) return;
    const card = cards.find((c) => c.mesh === hit.object);
    if (!card) return;

    card.pop = 1;
    card.face.map?.dispose();
    card.face.map = faceTexture(
      card.item,
      CARD_COLOURS[cards.indexOf(card) % CARD_COLOURS.length]!,
      card.emoji,
      true,
    );
    card.face.needsUpdate = true;
    options.onPick?.(card.item);
    options.onAdded?.(card.item);
    // Put the face back after the pop, or every card ends the night saying ADDED.
    setTimeout(() => {
      card.face.map?.dispose();
      card.face.map = faceTexture(
        card.item,
        CARD_COLOURS[cards.indexOf(card) % CARD_COLOURS.length]!,
        card.emoji,
        false,
      );
      card.face.needsUpdate = true;
    }, 1200);
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    target = Math.min(Math.max(target + e.deltaY * unitsPerPixel(), 0), maxScroll);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => (dragging = false));
  canvas.addEventListener('wheel', onWheel, { passive: false });

  let frame = 0;
  let stopped = false;

  function tick() {
    if (stopped) return;
    frame = requestAnimationFrame(tick);

    // Eased, so a flick coasts to a stop rather than snapping.
    scroll += (target - scroll) * 0.12;
    wall.position.y = scroll;

    for (const card of cards) {
      if (card.pop > 0) {
        card.pop = Math.max(0, card.pop - 0.03);
        // Toward the viewer and back. The flat menu flashes a colour; here the card
        // physically comes out of the wall, which is the same message in the medium
        // this view actually has.
        const ease = Math.sin(card.pop * Math.PI);
        card.mesh.position.z = card.home.z + ease * 1.5;
        card.mesh.rotation.x = ease * -0.16;
      }
      // Lean away from centre, so the wall curves around the viewer rather than
      // reading as a flat photograph of the flat menu.
      const dy = card.mesh.position.y + scroll;
      card.mesh.rotation.y = card.mesh.position.x * -0.028;
      card.mesh.rotation.z = card.mesh.position.x * 0.004;
      card.mesh.position.z = card.home.z + (card.pop > 0 ? card.mesh.position.z - card.home.z : 0);
      // Rows above and below fall away, which is what gives the scroll its depth.
      card.mesh.position.z -= Math.min(Math.abs(dy) * 0.045, 2.2);
    }

    renderer.render(scene, camera);
  }
  tick();

  return {
    setItems(next) {
      items = next;
      layout();
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Same rule as the flat grid: two columns on a phone, more when there's room.
      const next = camera.aspect < 0.85 ? 2 : camera.aspect < 1.5 ? 3 : 4;
      if (next !== columns) {
        columns = next;
        layout();
      }
      // Frame exactly `columns` cards across, so the grid fills the screen the way
      // the flat one does at any width — derived rather than hand-tuned.
      const needWidth = columns * (CARD_W + GAP) + 1.2;
      const needHeight = needWidth / camera.aspect;
      const back = needHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      camera.position.set(0, 0, Math.max(back, 9));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    },
    dispose() {
      stopped = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      clearCards();
      geometry.dispose();
      edge.dispose();
      backGeo.dispose();
      backMat.dispose();
      renderer.dispose();
    },
  };
}
