/**
 * Native-only bootstrap. Imported lazily from main.ts ONLY when running inside
 * Capacitor, so none of this (or @capacitor/status-bar) ships in the web bundle.
 * Style the OS status bar to match the bright-yellow app chrome.
 */
import { StatusBar, Style } from '@capacitor/status-bar';

export async function initNative(): Promise<void> {
  try {
    await StatusBar.setStyle({ style: Style.Dark }); // dark icons for the light bar
    await StatusBar.setBackgroundColor({ color: '#ffe600' }); // Android
  } catch {
    /* StatusBar not available on this platform — non-fatal */
  }
}
