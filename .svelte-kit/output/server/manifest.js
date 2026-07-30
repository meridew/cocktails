export const manifest = (() => {
  function __memo(fn) {
    let value;
    return () => (value ??= value = fn());
  }

  return {
    appDir: '_app',
    appPath: '_app',
    assets: new Set([
      'apple-touch-icon.png',
      'favicon.svg',
      'maskable-512.png',
      'pwa-192.png',
      'pwa-512.png',
    ]),
    mimeTypes: { '.png': 'image/png', '.svg': 'image/svg+xml' },
    _: {
      client: {
        start: '_app/immutable/entry/start.DBuRay0g.js',
        app: '_app/immutable/entry/app.Bv-Z0xM0.js',
        imports: [
          '_app/immutable/entry/start.DBuRay0g.js',
          '_app/immutable/chunks/CdqB6jFE.js',
          '_app/immutable/chunks/BoyJjPm4.js',
          '_app/immutable/chunks/BoLmkAbQ.js',
          '_app/immutable/entry/app.Bv-Z0xM0.js',
          '_app/immutable/chunks/BoyJjPm4.js',
          '_app/immutable/chunks/CSlEPxhp.js',
          '_app/immutable/chunks/C7ZFKefg.js',
          '_app/immutable/chunks/BoLmkAbQ.js',
          '_app/immutable/chunks/CtkE3022.js',
        ],
        stylesheets: [],
        fonts: [],
        uses_env_dynamic_public: false,
      },
      nodes: [
        __memo(() => import('./nodes/0.js')),
        __memo(() => import('./nodes/1.js')),
        __memo(() => import('./nodes/2.js')),
      ],
      remotes: {},
      routes: [
        {
          id: '/',
          pattern: /^\/$/,
          params: [],
          page: { layouts: [0], errors: [1], leaf: 2 },
          endpoint: null,
        },
        {
          id: '/api/health',
          pattern: /^\/api\/health\/?$/,
          params: [],
          page: null,
          endpoint: __memo(() => import('./entries/endpoints/api/health/_server.ts.js')),
        },
      ],
      prerendered_routes: new Set([]),
      matchers: async () => {
        return {};
      },
      server_assets: {},
    },
  };
})();
