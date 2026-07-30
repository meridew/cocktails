export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["apple-touch-icon.png","favicon.svg","maskable-512.png","pwa-192.png","pwa-512.png"]),
	mimeTypes: {".png":"image/png",".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.BmksjObn.js",app:"_app/immutable/entry/app.B54PgPRb.js",imports:["_app/immutable/entry/start.BmksjObn.js","_app/immutable/chunks/DcfErh_I.js","_app/immutable/chunks/BoyJjPm4.js","_app/immutable/chunks/BoLmkAbQ.js","_app/immutable/entry/app.B54PgPRb.js","_app/immutable/chunks/BoyJjPm4.js","_app/immutable/chunks/CSlEPxhp.js","_app/immutable/chunks/C7ZFKefg.js","_app/immutable/chunks/BoLmkAbQ.js","_app/immutable/chunks/CtkE3022.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/auth/login",
				pattern: /^\/api\/auth\/login\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/auth/login/_server.ts.js'))
			},
			{
				id: "/api/auth/logout",
				pattern: /^\/api\/auth\/logout\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/auth/logout/_server.ts.js'))
			},
			{
				id: "/api/auth/me",
				pattern: /^\/api\/auth\/me\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/auth/me/_server.ts.js'))
			},
			{
				id: "/api/auth/pin",
				pattern: /^\/api\/auth\/pin\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/auth/pin/_server.ts.js'))
			},
			{
				id: "/api/health",
				pattern: /^\/api\/health\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/health/_server.ts.js'))
			},
			{
				id: "/api/orders",
				pattern: /^\/api\/orders\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/orders/_server.ts.js'))
			},
			{
				id: "/api/orders/clear",
				pattern: /^\/api\/orders\/clear\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/orders/clear/_server.ts.js'))
			},
			{
				id: "/api/orders/[id]",
				pattern: /^\/api\/orders\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/orders/_id_/_server.ts.js'))
			},
			{
				id: "/api/orders/[id]/bump",
				pattern: /^\/api\/orders\/([^/]+?)\/bump\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/orders/_id_/bump/_server.ts.js'))
			},
			{
				id: "/api/orders/[id]/progress",
				pattern: /^\/api\/orders\/([^/]+?)\/progress\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/orders/_id_/progress/_server.ts.js'))
			},
			{
				id: "/api/push/key",
				pattern: /^\/api\/push\/key\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/push/key/_server.ts.js'))
			},
			{
				id: "/api/staff",
				pattern: /^\/api\/staff\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/_server.ts.js'))
			},
			{
				id: "/api/staff/claim",
				pattern: /^\/api\/staff\/claim\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/claim/_server.ts.js'))
			},
			{
				id: "/api/staff/join-code",
				pattern: /^\/api\/staff\/join-code\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/join-code/_server.ts.js'))
			},
			{
				id: "/api/staff/join",
				pattern: /^\/api\/staff\/join\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/join/_server.ts.js'))
			},
			{
				id: "/api/staff/requests",
				pattern: /^\/api\/staff\/requests\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/requests/_server.ts.js'))
			},
			{
				id: "/api/staff/revoke-all",
				pattern: /^\/api\/staff\/revoke-all\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/revoke-all/_server.ts.js'))
			},
			{
				id: "/api/staff/[id]",
				pattern: /^\/api\/staff\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/_id_/_server.ts.js'))
			},
			{
				id: "/api/staff/[id]/approve",
				pattern: /^\/api\/staff\/([^/]+?)\/approve\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/_id_/approve/_server.ts.js'))
			},
			{
				id: "/api/staff/[id]/revoke",
				pattern: /^\/api\/staff\/([^/]+?)\/revoke\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/staff/_id_/revoke/_server.ts.js'))
			},
			{
				id: "/api/subscriptions",
				pattern: /^\/api\/subscriptions\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/subscriptions/_server.ts.js'))
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
