
import root from '../root.js';
import { set_building, set_prerendering } from '$app/env/internal';
import { set_assets } from '$app/paths/internal/server';
import { set_manifest, set_read_implementation } from '__sveltekit/server';
import { set_private_env, set_public_env } from '../../../node_modules/@sveltejs/kit/src/runtime/shared-server.js';
import error from '../shared/error-template.js';

export const options = {
	app_template_contains_nonce: false,
	async: false,
	csp: {"mode":"auto","directives":{"upgrade-insecure-requests":false,"block-all-mixed-content":false},"reportOnly":{"upgrade-insecure-requests":false,"block-all-mixed-content":false}},
	csrf_check_origin: true,
	csrf_trusted_origins: [],
	embedded: false,
	env_public_prefix: 'PUBLIC_',
	env_private_prefix: '',
	hash_routing: false,
	hooks: null, // added lazily, via `get_hooks`
	preload_strategy: "modulepreload",
	root,
	service_worker: false,
	service_worker_options: undefined,
	server_error_boundaries: false,
	templates: {
		app: ({ head, body, assets, nonce, env }) => "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />\n    <meta name=\"description\" content=\"Build a round, drop your name, get served.\" />\n    <meta name=\"theme-color\" content=\"#ffe600\" />\n    <!-- iOS PWA: install as a real full-screen app (required for standalone + web push) -->\n    <meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />\n    <meta name=\"mobile-web-app-capable\" content=\"yes\" />\n    <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\" />\n    <meta name=\"apple-mobile-web-app-title\" content=\"Cocktails\" />\n    <link rel=\"icon\" type=\"image/svg+xml\" href=\"" + assets + "/favicon.svg\" />\n    <link rel=\"icon\" type=\"image/png\" sizes=\"192x192\" href=\"" + assets + "/pwa-192.png\" />\n    <link rel=\"apple-touch-icon\" href=\"" + assets + "/apple-touch-icon.png\" />\n    <link rel=\"manifest\" href=\"" + assets + "/manifest.webmanifest\" />\n    " + head + "\n  </head>\n  <body data-sveltekit-preload-data=\"hover\">\n    <div id=\"app\">" + body + "</div>\n  </body>\n</html>\n",
		error
	},
	version_hash: "qv6855"
};

export async function get_hooks() {
	let handle;
	let handleFetch;
	let handleError;
	let handleValidationError;
	let init;
	({ handle, handleFetch, handleError, handleValidationError, init } = await import("../../../src/hooks.server.ts"));

	let reroute;
	let transport;
	

	return {
		handle,
		handleFetch,
		handleError,
		handleValidationError,
		init,
		reroute,
		transport
	};
}

export { set_assets, set_building, set_manifest, set_prerendering, set_private_env, set_public_env, set_read_implementation };
