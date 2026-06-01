import { mount } from 'svelte';
// Self-hosted display + body fonts (bundled by Vite, no Google CDN).
import '@fontsource/archivo-black';
import '@fontsource/bungee';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './neo.css'; // the original bespoke neo-brutalist design
import './app.css'; // canvas-confetti layer
import { Capacitor } from '@capacitor/core';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

// Native-only bootstrap (status bar, etc.) — never loaded in the web/PWA build.
if (Capacitor.isNativePlatform()) {
  void import('./lib/native').then((m) => m.initNative());
}

export default app;
