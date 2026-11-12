// App version + download URL helpers.
//
// Version is read directly from package.json so it survives HMR — the
// previous `__APP_VERSION__` define was injected at Vite server start, so
// any version bump made while the dev server was running stayed stale in
// the browser until a full restart. Production builds inline this import
// the same way Vite would have inlined the define.
//
// The desktop download URL is read from `VITE_DESKTOP_DOWNLOAD_URL` — we host
// the latest installer alongside the web app (e.g. `/downloads/latest/`) and
// that env var points at it. No env = fallback to `/downloads/` so the
// developer hitting a local build at least gets a directory listing rather
// than a broken link.

import pkg from '../../package.json';

export function getAppVersion(): string {
  return pkg.version;
}

export function getDesktopDownloadUrl(): string {
  const envUrl = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl;
  // Fallback matches `scripts/stage-desktop.mjs`'s stable-URL copy.
  return '/downloads/PatchMan-latest.dmg';
}
