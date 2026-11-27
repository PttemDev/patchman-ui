# AGENTS.md — PatchMan frontend and desktop

Instructions for AI coding agents (and a short checklist for people). The full guide is
[docs/dev/](docs/dev/README.md). Read [docs/dev/rules.md](docs/dev/rules.md) before you change code.

- **Typecheck:** `npx tsc -p tsconfig.app.json --noEmit`. Plain `tsc --noEmit -p .` checks nothing.
  Also run `npx eslint <files>` and `npm run check:i18n`.
- **Every user-facing string** goes through `t()`, with keys in en, tr, es and zh. The pre-commit hook
  enforces it.
- **Connections are dual-written** to every backend in `availableDBScopes()` with a frontend-generated
  id. Route calls with `dbCfg(scope)`.
- **Read lists from the API as `x ?? []`**, because an older backend may send `null`. Show `—` for
  unknown numbers.
- **Every lazy import** uses `lazyWithReload`, not `React.lazy`.
- **Tauri `beforeBuildCommand` stays `npm run build:desktop`.** Plain `npm run build` embeds old DMGs
  in the binary.
- **No company domains or hosts in code.** Use `src/lib/tenant.ts` and Vite env.
- **Desktop:** macOS-only chrome (title-bar padding, drag regions) goes behind
  `hasOverlayTitleBar()`.
- **Click-test** against a scratch backend, never one started from the patchman-api repo root
  ([docs/dev/testing.md](docs/dev/testing.md)).
- **Git:** commit or push only when the person you work for asks. No `Co-Authored-By` footer.
  Releases are made by the maintainers ([docs/dev/release.md](docs/dev/release.md)).
- **Every release** bumps the version in 5 files and adds a changelog entry
  ([docs/dev/release.md](docs/dev/release.md)).
- **Keep the app identifier `com.pttem.patchman`.** People switch between PatchMan builds and keep
  their data ([docs/dev/architecture.md](docs/dev/architecture.md#builds-and-the-app-identifier)).
