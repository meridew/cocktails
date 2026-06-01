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
            // We own the service worker (src/sw.ts) so it can handle Web Push.
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
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
            injectManifest: {
              globPatterns: ['**/*.{js,css,html,svg,woff2}'],
            },
            // Run the SW in dev too so push can be tested on http://localhost
            // (a secure context). Disabled automatically for the native build.
            devOptions: { enabled: true, type: 'module', navigateFallback: '/index.html' },
          }),
        ]),
  ],
  server: {
    // Dedicated port (not Vite's default 5173) so it never clashes with other
    // projects. The dev hub lives at http://localhost:5180/dev.html.
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
