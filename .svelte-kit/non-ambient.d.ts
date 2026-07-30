
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/auth" | "/api/auth/login" | "/api/auth/logout" | "/api/auth/me" | "/api/auth/pin" | "/api/health" | "/api/orders" | "/api/orders/clear" | "/api/orders/[id]" | "/api/orders/[id]/bump" | "/api/orders/[id]/progress" | "/api/push" | "/api/push/key" | "/api/staff" | "/api/staff/claim" | "/api/staff/join-code" | "/api/staff/join" | "/api/staff/requests" | "/api/staff/revoke-all" | "/api/staff/[id]" | "/api/staff/[id]/approve" | "/api/staff/[id]/revoke" | "/api/subscriptions";
		RouteParams(): {
			"/api/orders/[id]": { id: string };
			"/api/orders/[id]/bump": { id: string };
			"/api/orders/[id]/progress": { id: string };
			"/api/staff/[id]": { id: string };
			"/api/staff/[id]/approve": { id: string };
			"/api/staff/[id]/revoke": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string | undefined };
			"/api": { id?: string | undefined };
			"/api/auth": Record<string, never>;
			"/api/auth/login": Record<string, never>;
			"/api/auth/logout": Record<string, never>;
			"/api/auth/me": Record<string, never>;
			"/api/auth/pin": Record<string, never>;
			"/api/health": Record<string, never>;
			"/api/orders": { id?: string | undefined };
			"/api/orders/clear": Record<string, never>;
			"/api/orders/[id]": { id: string };
			"/api/orders/[id]/bump": { id: string };
			"/api/orders/[id]/progress": { id: string };
			"/api/push": Record<string, never>;
			"/api/push/key": Record<string, never>;
			"/api/staff": { id?: string | undefined };
			"/api/staff/claim": Record<string, never>;
			"/api/staff/join-code": Record<string, never>;
			"/api/staff/join": Record<string, never>;
			"/api/staff/requests": Record<string, never>;
			"/api/staff/revoke-all": Record<string, never>;
			"/api/staff/[id]": { id: string };
			"/api/staff/[id]/approve": { id: string };
			"/api/staff/[id]/revoke": { id: string };
			"/api/subscriptions": Record<string, never>
		};
		Pathname(): "/" | "/api/auth/login" | "/api/auth/logout" | "/api/auth/me" | "/api/auth/pin" | "/api/health" | "/api/orders" | "/api/orders/clear" | `/api/orders/${string}` & {} | `/api/orders/${string}/bump` & {} | `/api/orders/${string}/progress` & {} | "/api/push/key" | "/api/staff" | "/api/staff/claim" | "/api/staff/join-code" | "/api/staff/join" | "/api/staff/requests" | "/api/staff/revoke-all" | `/api/staff/${string}` & {} | `/api/staff/${string}/approve` & {} | `/api/staff/${string}/revoke` & {} | "/api/subscriptions";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/apple-touch-icon.png" | "/favicon.svg" | "/maskable-512.png" | "/pwa-192.png" | "/pwa-512.png" | string & {};
	}
}