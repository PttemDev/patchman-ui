# Frontend rules (invariants)

Nothing enforces these rules mechanically, but each one was learned from a bug. If a change has to
break one, say so in the commit and update this file.

## Text and i18n

- **Every user-facing string** (labels, toasts, errors, empty states, tooltips, aria-labels) goes
  through `t()` with keys in **all four** locales: `en`, `tr`, `es`, `zh`.
- The pre-commit hook (`.githooks/pre-commit` → `scripts/check-i18n.mjs`) blocks a commit whose
  locales disagree. `npm install` enables the hook via `prepare`; run `npm run check:i18n` to check by
  hand.
- Keep terms consistent with `src/i18n/GLOSSARY.md`.
- `src/data/changelog.ts` is English only.

## Types and lint

- Typecheck with **`npx tsc -p tsconfig.app.json --noEmit`**. `tsc --noEmit -p .` uses the root
  tsconfig, which has only project references, so it checks nothing and passes falsely.
- `npx eslint <files>` must not add errors. Older warnings exist; don't add new ones.

## Data from the backend

- **Tolerate `null` where you expect a list.** The desktop app can talk to a backend of a different
  version, and an older one may send `null`. Use `(x ?? []).map(...)` on lists from the API (1.71.2
  crash: `null is not an object (evaluating 'ge.points.map')`).
- **Unknown is not zero.** Show `—` for null or unknown numbers; never fill in an estimate.
- **The API rejects HTML answers** (`HtmlResponseError` in `services/api.ts`). If you see one, the
  backend URL is wrong, not the parser.

## Connections and the two backends

- **Dual-write:** creating, updating and deleting a connection calls `Promise.all` over
  `availableDBScopes()`. The **frontend generates the id** (UUID v4) so both rows share it, and stores
  de-duplicate by id. A partial failure is reported but tolerated.
- Pick the backend for a call with `dbCfg(scope)`. Don't hard-code `/api` paths around it.
- Grants and shares go to the remote backend (`shareScopeFor` in `components/common/shareScope.ts`).
- Viewers can't edit. Check the role (`myRole`) before showing edit actions or drag handles.

## Code loading

- **Every `lazy(() => import(...))` uses `lazyWithReload`** (`src/lib/lazyWithReload.ts`). After a
  deploy the old hashed chunk is gone; plain `React.lazy` then crashes the tab, while `lazyWithReload`
  reloads it once.
- Heavy editors (Monaco) stay behind lazy boundaries. Don't import them from the entry path.

## Tenant config

- Per-client values come from `src/lib/tenant.ts` (`emailPlaceholder()`, `gitlabHostname()`,
  `gitlabBaseUrl()`) and Vite env (`.env.tenant.example`).
- Never write company domains or hosts into code.

## Desktop build

- **`beforeBuildCommand` stays `npm run build:desktop`.** That script deletes `dist/downloads` after
  Vite copies `public/` into `dist/`. Tauri embeds the whole `frontendDist` in the binary, so plain
  `npm run build` would embed previous DMGs from `public/downloads/` and produce multi-GB binaries and
  linker errors.
- **A production build talks to the backend in `VITE_API_URL`.** If your `.env` or
  `.env.production` sets it, use
  `env VITE_API_URL= npx vite build --outDir <scratch>` for local end-to-end tests.
- **Title bar:** on Windows and Linux the native title bar stays. Use `hasOverlayTitleBar()`, not
  `isDesktop()`, for macOS-only padding and drag regions.

## Git and releases

- **No commit and no push** unless the person you work for asks.
- **Releases** follow [release.md](release.md).
- **No `Co-Authored-By` footer** in commit messages.
- **Every release adds a changelog entry** at the top of `src/data/changelog.ts`.
