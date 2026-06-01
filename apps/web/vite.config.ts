import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// `vite build --mode native` builds the Capacitor (app) bundle: no service
// worker (the native app is its own offline shell) and VITE_API_BASE comes from
// .env.native (the public HTTPS origin). The web/PWA build is the default mode.
export default defineConfig(({ mode }) => {
  const isNative = mode === 'native';

  return {
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
              includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
              manifest: {
                name: 'Cocktails',
                short_name: 'Cocktails',
                description: 'Build a round, drop your name, get served.',
                theme_color: '#ffe600',
                background_color: '#ffe600',
                display: 'standalone',
                start_url: '/',
                icons: [
                  { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
                  { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                  { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
                ],
              },
              injectManifest: {
                globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
              },
              // Run the SW in dev too so push can be tested on http://localhost.
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
  };
});
