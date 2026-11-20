# Release

Releases are made by the maintainers. Contributors open a pull request; they don't bump versions or
publish builds. AI agents: never commit, tag, build a release or push unless the person you work for
asks.

Desktop builds are published as [GitHub Releases](https://github.com/PttemDev/patchman-ui/releases)
and are never committed to the repository. The README section
[Publishing a release](../../README.md#publishing-a-release-maintainers) has the exact commands.

## 1. Pick the version (semver)

- **patch**: bug fixes only.
- **minor**: a new feature, endpoint or setting that stays compatible.
- **major**: a breaking change (a removed feature, an incompatible API, a data migration).

## 2. Bump it everywhere (all at once)

| File | Where |
|---|---|
| `package.json` | `"version"` (line 4) |
| `src-tauri/tauri.conf.json` | `"version"` (line 4) |
| `src-tauri/Cargo.toml` | `[package] version` (line 3) |
| `src-tauri/Cargo.lock` | the `patchman-desktop` package entry |
| `package-lock.json` | the root `"version"` and `packages[""].version` (lines 3 and 9) |

The app shows `package.json`'s version (`__APP_VERSION__`); the installer and `latest.json` use
`tauri.conf.json`'s. If they drift, users see two different numbers.

## 3. Changelog

Add a new **top** entry to `src/data/changelog.ts` on **every** release, patch releases included:
`version`, `date`, a short `title` and one line per user-visible change, in plain English. Say what
changed for the user, not which file.

## 4. Verify

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run check:i18n
npm run build
(cd src-tauri && cargo check)
```

And in patchman-api: `go build ./... && go vet ./... && go test ./...`.

## 5. Build the macOS app (maintainer's Mac)

Signing and notarization need the maintainer's Apple Developer ID certificate, so the macOS build runs
locally:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat <updater private key file>)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
GOTOOLCHAIN=go1.26.11 npm run tauri:build
```

- It also needs `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, and a
  gitignored `src-tauri/tauri.tenant.json` with the Developer ID `signingIdentity` and
  `"createUpdaterArtifacts": true`.
- **Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, even when it is empty.** Without it the signer asks for
  a password, the update package gets no `.sig`, and the chain stops before the DMG is notarized and
  stapled.
- The DMG lands in `public/downloads/` (gitignored); the update package is
  `src-tauri/target/release/bundle/macos/PatchMan.app.tar.gz` and its `.sig`.

## 6. Tag and push (patchman-api first)

1. Commit each repository on its own. Message: `Release <version>: <what changed>`. No
   `Co-Authored-By` footer.
2. Tag both with `v<version>` (`git tag -a v<version>`). Push the **patchman-api** tag first, then
   patchman-ui's branch and tag.
3. The tag push starts [`desktop-release.yml`](../../.github/workflows/desktop-release.yml). It builds
   the Windows and Linux packages against the patchman-api tag of the same name, creates a draft
   release and attaches them with their `SHA256SUMS` lines and `latest.json` entries. To try the
   workflow without a release, push to the `ci/desktop-release` branch.

## 7. Publish

When the workflow has finished:

- Attach the DMG and the macOS update package (`PatchMan-<version>-aarch64.app.tar.gz` and its
  `.sig` contents in `latest.json`).
- Add the DMG to `SHA256SUMS` and merge the macOS entries into `latest.json` with
  `scripts/update-manifest.mjs`, keeping the Windows and Linux lines.
- Add the release notes and publish the draft as the latest release.
- Check that `releases/latest/download/latest.json` and every URL in it answer 200.

## Shared code with the non-public copy

PatchMan is also built from a separate, non-public copy, and code is ported between the two.

- **App identifier:** both keep `com.pttem.patchman` **on purpose**, so people can switch between the
  builds and keep their data. Don't change it.
- **Updater block:** this repository's `tauri.conf.json` has its own GitHub Releases updater block.
  Keep it when porting.
- **Shared fixes** go into both copies with the same code, so later ports don't conflict.
