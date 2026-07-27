import { invalidations, type InvalidationKey } from '$lib/stores/invalidations.svelte';

/**
 * Connected mode's WebSocket feed into the invalidations bus (ROADMAP_MULTI_COMPUTER.md
 * Phase 1, §3.4) — the counterpart to solo mode's per-component timer feeds. Started once
 * from +layout.svelte when a server connection is active; reconnects with backoff if the
 * server restarts or the LAN blips, since a clinic can't have this silently stop updating.
 *
 * Watchdog: some WebView WebSocket implementations don't reliably fire 'close' when the
 * underlying TCP connection dies abruptly (server crash/restart, not a clean close
 * handshake) rather than a graceful close — observed in practice against Tauri's WKWebView
 * on macOS, where a killed server left the socket looking "open" from the client's
 * perspective indefinitely. The server sends a `{"entity":"__heartbeat__"}` message every
 * 15s (main.rs); if HEARTBEAT_TIMEOUT_MS passes with no message of any kind, the watchdog
 * force-tears-down and reconnects rather than trusting 'close' to fire on its own.
 */

const HEARTBEAT_TIMEOUT_MS = 35_000; // > 2x the server's 15s heartbeat interval

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1000;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrlFor(httpUrl: string): string {
	return httpUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/events';
}

function clearWatchdog(): void {
	if (watchdogTimer) {
		clearTimeout(watchdogTimer);
		watchdogTimer = null;
	}
}

export function connectEvents(serverUrl: string, token: string): void {
	if (socket) return; // already connected/connecting
	const url = `${wsUrlFor(serverUrl)}?token=${encodeURIComponent(token)}`;
	// axum's ws_handler is behind the same bearer-token middleware as /rpc — WebSocket
	// upgrade requests can't carry a custom Authorization header from browser/webview
	// APIs, hence the token as a query param here (server-side accepts either, see auth.rs).
	const ws = new WebSocket(url);
	socket = ws;

	const teardown = () => {
		clearWatchdog();
		socket = null;
		if (reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connectEvents(serverUrl, token);
		}, reconnectDelayMs);
		reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
	};

	function resetWatchdog() {
		clearWatchdog();
		watchdogTimer = setTimeout(() => {
			// No traffic (heartbeat or otherwise) within the timeout — the connection is
			// presumed dead even though no 'close'/'error' event told us so. Force it.
			ws.close();
			teardown();
		}, HEARTBEAT_TIMEOUT_MS);
	}

	ws.addEventListener('open', () => {
		reconnectDelayMs = 1000;
		resetWatchdog();
	});

	ws.addEventListener('message', (event) => {
		resetWatchdog();
		try {
			const msg = JSON.parse(event.data) as { entity?: InvalidationKey['entity'] | '__heartbeat__' };
			if (msg.entity && msg.entity !== '__heartbeat__') invalidations.emitEntity(msg.entity);
		} catch {
			// malformed message — ignore, not worth dropping the connection over
		}
	});

	ws.addEventListener('close', teardown);
	ws.addEventListener('error', () => ws.close());
}

export function disconnectEvents(): void {
	clearWatchdog();
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	socket?.close();
	socket = null;
}
