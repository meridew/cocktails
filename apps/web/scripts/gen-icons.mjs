// Rasterize public/favicon.svg into every web + native icon size.
// Run from apps/web:  npm run icons
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';

mkdirSync('assets', { recursive: true });

const full = readFileSync('public/favicon.svg', 'utf8');
// foreground = same symbol with the yellow background stripped (transparent),
// for Android adaptive icons + the splash composite.
const fg = full.replace('<rect width="512" height="512" fill="#ffe600"/>', '');

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png();

// --- web (public/) ---
await render(full, 192).toFile('public/pwa-192.png');
await render(full, 512).toFile('public/pwa-512.png');
await render(full, 512).toFile('public/maskable-512.png');
await render(full, 180).toFile('public/apple-touch-icon.png');

// --- native sources for @capacitor/assets (assets/) ---
await render(full, 1024).toFile('assets/icon-only.png');
await render(fg, 1024).toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffe600' } })
  .png()
  .toFile('assets/icon-background.png');

const logo = await render(fg, 1150).toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#ffe600' } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile('assets/' + name);
}

console.log('✓ generated web + native icon assets from public/favicon.svg');
