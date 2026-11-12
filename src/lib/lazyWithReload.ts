import { lazy, type ComponentType } from 'react';

// React.lazy that survives a deploy. A web tab keeps running the build it
// loaded; once a new version is deployed, the old hashed chunks are gone
// (and `serve -s` answers the missing .js with index.html), so the first
// lazy import after the deploy — opening a whiteboard, the code editor —
// fails with "Failed to fetch dynamically imported module" and the error
// boundary takes the whole app down.
//
// On that error we reload once: the fresh index.html points at the new
// chunks. The returned promise never settles, so Suspense keeps showing its
// fallback until the reload lands. A second failure within RELOAD_WINDOW_MS
// (offline, VPN down, a genuinely broken deploy) is rethrown instead, so it
// can't loop and still reaches the error boundary / reporter.

const RELOAD_KEY = 'patchman:chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

// Chromium / Firefox / Safari wordings, Safari's when the server answers the
// .js with index.html (what `serve -s` does for a removed chunk), and Vite's
// own preload-helper error.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type|Unable to preload/i;

export function isChunkLoadError(err: unknown): boolean {
  return err instanceof Error && CHUNK_ERROR.test(err.message);
}

// Reloads the page unless it already did so very recently; returns whether
// a reload is underway.
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // no storage → no loop guard → don't risk a reload loop
  }
  window.location.reload();
  return true;
}

export function lazyWithReload<T extends ComponentType<any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (isChunkLoadError(err) && reloadOnce()) return new Promise<{ default: T }>(() => {});
      throw err;
    }),
  );
}
