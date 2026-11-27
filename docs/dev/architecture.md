# Architecture (frontend and desktop)

## Web app

- React + TypeScript + Vite. The entry is `src/main.tsx`, then `src/App.tsx`.
- **State** lives in zustand stores in `src/stores/`, one per feature (`collectionStore`,
  `dbConnectionStore`, `observabilityConnectionStore`, …). Cross-store wiring is in
  `stores/storeWiring.ts`.
- **API** calls go through `src/services/api.ts` (axios). The response interceptor unwraps the
  backend's `{"data": …}` envelope and rejects HTML answers (a wrong backend URL) with
  `HtmlResponseError`.
- **UI**: components in `src/components/<feature>/`, shared primitives in `src/components/ui/`, and
  charts in `src/components/charts/TimeSeriesChart.tsx` (recharts). Reuse that chart; don't add another
  chart library.
- **i18n** uses react-i18next. Namespaces live in `src/i18n/locales/{en,tr,es,zh}/<ns>.json`; the
  term glossary is `src/i18n/GLOSSARY.md`.
- **Release notes** shown in the app are in `src/data/changelog.ts`.

## Two backends: local and remote

The desktop app runs an embedded backend (local) and also talks to the team's backend (remote). The
web app has only the remote one.

- `DBScope = 'local' | 'remote'`. `availableDBScopes()` (`stores/dbConnectionStore.ts`) says which
  are reachable right now.
- `dbCfg(scope, extra)` in `services/api.ts` builds the axios config that sends a call to one backend
  (`_executionPin`). Every connection-tool API call takes an optional scope.
- **Connections are dual-written** to every reachable backend with the same id. Each backend encrypts
  secrets with its own key, so a row exists on a backend only if it was written there.
- **Grants and sharing exist only on the remote backend.** Share dialogs always write grants there
  (`components/common/shareScope.ts`).
- **The remote address** is user-configurable (Settings → Remote, `stores/remoteStore.ts`). The
  baked-in `VITE_API_URL` is only the default.

## Desktop shell (Tauri)

- `src-tauri/`: Rust shell (`src/lib.rs`, `security.rs`, `plugindev.rs`). The toolchain is pinned in
  `src-tauri/rust-toolchain.toml`.
- The shell starts the **Go backend as a sidecar** (`scripts/build-sidecar.mjs` builds it), drains its
  stdout into `~/Library/Logs/com.pttem.patchman/sidecar.log`, waits until it is ready and then loads
  the web app.
- **Launch token**: the embedded backend refuses requests without the per-launch token.
  `src/lib/localApiAuth.ts` wraps fetch, XHR, WebSocket and EventSource once, so new local call sites
  need nothing extra.
- **App lock / step-up** state lives in the shell (`security.rs`). On macOS the cipher key is in the
  Keychain. Windows and Linux have no lock yet, and their key is a file next to the database.
- **Platform helpers** are in `src/lib/platform.ts`:
  - `isDesktop()` and `getLocalApiUrl()`.
  - `hasOverlayTitleBar()`: macOS only. Windows and Linux keep their native title bar, so don't add
    traffic-light padding or drag regions there.
- **Tenant config**: `src-tauri/tauri.conf.json` holds no tenant values. The updater endpoint, pubkey
  and signing identity come from the gitignored `tauri.tenant.json`, merged by
  `scripts/render-tauri-conf.mjs`.

## Builds and the app identifier

PatchMan is also built from a separate, non-public copy of these repositories, and code is ported
between them.

- Every build keeps the app identifier `com.pttem.patchman` **on purpose**: people can install one
  build over another and keep their settings, local data and session. Don't change it here. A fork
  that publishes its own app should change it (see the README).
- This repository's `tauri.conf.json` has its own updater block that points at GitHub Releases.
- A desktop build whose baked-in backend URL is relative (`/api`, the default here) uses the backend
  the previous build signed in to (`desktopBuiltinFallback` in `stores/remoteStore.ts`). On a fresh
  install the app asks for a backend URL.
