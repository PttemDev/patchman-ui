// Platform + embedded-backend discovery.
//
// The Tauri shell spawns the Go sidecar on a random localhost port, then
// exposes the resolved URL to the webview via a global before handing off
// control. Until Phase 4.2 lands, the fallback is VITE_LOCAL_API_URL so
// developers can point a browser tab at a hand-started embedded BE and
// exercise the same code path.

declare global {
  interface Window {
    // Set by the Tauri sidecar bootstrap before the app renders.
    __PATCHMAN_LOCAL_API__?: string;
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * True when the webview is hosted inside a Tauri shell. Used to unlock
 * desktop-only behavior (embedded BE, QA tabs in local mode, etc.).
 */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

/**
 * URL of the embedded Go backend. Returns null when no embedded source is
 * available (e.g. plain browser build without VITE_LOCAL_API_URL set).
 *
 * Resolution order:
 *   1. Tauri-injected `window.__PATCHMAN_LOCAL_API__`
 *   2. Build-time `VITE_LOCAL_API_URL`
 *   3. null → caller must fall back to the remote BE
 */
export function getLocalApiUrl(): string | null {
  if (typeof window !== 'undefined' && window.__PATCHMAN_LOCAL_API__) {
    return stripTrailingSlash(window.__PATCHMAN_LOCAL_API__);
  }
  // Detached desktop window: the sidecar URL is passed in the `?api=` query
  // param and cached back onto the global here. The Rust bootstrap only pins
  // __PATCHMAN_LOCAL_API__ for the 'main' window, and Tauri's
  // create_webview_window command rejects an initializationScript option, so
  // the query param is how a detached window learns the embedded BE URL.
  if (typeof window !== 'undefined') {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('api');
      if (fromQuery) {
        window.__PATCHMAN_LOCAL_API__ = fromQuery;
        return stripTrailingSlash(fromQuery);
      }
    } catch {
      /* ignore malformed search */
    }
  }
  const env = import.meta.env.VITE_LOCAL_API_URL;
  if (typeof env === 'string' && env.length > 0) {
    return stripTrailingSlash(env);
  }
  return null;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}
