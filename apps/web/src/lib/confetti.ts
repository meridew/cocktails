import confetti from 'canvas-confetti';

// Ingredient / drink emojis for the background cannon + celebration.
// (Yes, the cheeky 🍆 is in there, per tradition.)
const EMOJIS = ['🍹', '🍸', '🍋', '🍈', '🌿', '🍓', '🌶️', '🧊', '🥃', '🍷', '🫚', '🍊', '🍒', '🍆'];

type Shape = ReturnType<typeof confetti.shapeFromText>;
let cached: Shape[] | null = null;
function shapes(): Shape[] {
  if (!cached) cached = EMOJIS.map((text) => confetti.shapeFromText({ text, scalar: 2.4 }));
  return cached;
}

/**
 * The party-popper background cannon: emoji blasting in from the side edges,
 * forever, on a dedicated low-z canvas behind the UI. Returns a stop fn.
 */
export function startBackgroundCannon(canvas: HTMLCanvasElement): () => void {
  const fire = confetti.create(canvas, { resize: true, useWorker: true });
  const sh = shapes();
  const shot = () => {
    const left = Math.random() < 0.5;
    fire({
      particleCount: 12,
      angle: left ? 60 : 120,
      spread: 75,
      startVelocity: 58,
      gravity: 0.9,
      decay: 0.92,
      scalar: 2.2,
      ticks: 360,
      flat: true,
      origin: { x: left ? -0.05 : 1.05, y: Math.random() * 0.5 + 0.45 },
      shapes: sh,
    });
  };
  shot();
  const id = window.setInterval(shot, 850);
  return () => window.clearInterval(id);
}

/** Foreground "yay you ordered" explosion — emoji + neon confetti. */
export function celebrate(): void {
  const sh = shapes();
  const neon = ['#ff2e88', '#29ffe3', '#c6ff00', '#ffe600'];
  // big central pop
  confetti({ particleCount: 140, spread: 160, startVelocity: 52, origin: { x: 0.5, y: 0.55 }, colors: neon, ticks: 260 });
  // emoji bursts from the corners, staggered
  const burst = (x: number, y: number, angle: number) =>
    confetti({ particleCount: 36, spread: 90, angle, startVelocity: 50, scalar: 1.7, flat: true, shapes: sh, origin: { x, y }, ticks: 280 });
  window.setTimeout(() => burst(0.1, 0.7, 60), 120);
  window.setTimeout(() => burst(0.9, 0.7, 120), 260);
  window.setTimeout(() => burst(0.5, 0.45, 90), 400);
}
