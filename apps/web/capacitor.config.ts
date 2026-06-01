import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the SAME web build as the native iOS/Android app. We bundle
 * `dist` (offline-capable + store-friendly) rather than live-loading the site,
 * so the app works without a connection and passes review. UI/UX changes are
 * just `npm run build:native && npx cap copy` (or an OTA live-update).
 *
 * To live-load the deployed site instead during early dev, uncomment `server`.
 */
const config: CapacitorConfig = {
  appId: 'com.meridew.cocktails',
  appName: 'Cocktails',
  webDir: 'dist',
  // server: { url: 'https://cock.meridew.com', cleartext: false },
};

export default config;
