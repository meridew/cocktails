import { mount } from 'svelte';
// Self-hosted display + body fonts (bundled by Vite, no Google CDN).
import '@fontsource/bungee';
import '@fontsource/archivo-black';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './app.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
