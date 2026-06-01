/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Absolute API base for the native build, e.g. `https://cock.meridew.com/api`
   * (include the `/api` suffix). The web build leaves this unset → same-origin `/api`.
   */
  readonly VITE_API_BASE?: string;
  /** `native` drops the service worker (the Capacitor bundle is its own shell). */
  readonly VITE_TARGET?: 'web' | 'native';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
