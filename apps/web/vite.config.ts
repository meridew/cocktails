import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// The native (Capacitor) build is its own offline shell, so we drop the PWA
// service worker there — an in-WebView SW would cache stale bundled assets.
// Build the app with `VITE_TARGET=native`.
const isNative = process.env.VITE_TARGET === 'native';

// Dev proxies /api → local Hono API so the web app talks to it with no CORS.
// In production Caddy does the same routing.
export default defineConfig({
  plugins: [
    svelte(),
    ...(isNative
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg'],
            manifest: {
              name: 'Cocktails',
              short_name: 'Cocktails',
              description: 'Build a round, drop your name, get served.',
              theme_color: '#ffe600',
              background_color: '#ffe600',
              display: 'standalone',
              start_url: '/',
              icons: [
                { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
              ],
            },
            // Phase 3 swaps this for injectManifest so we own the service worker
            // (Web Push lives there). For now: generateSW for offline shell.
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,woff2}'],
              navigateFallback: '/index.html',
            },
            devOptions: { enabled: false },
          }),
        ]),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
