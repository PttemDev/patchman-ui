#!/usr/bin/env bash
# Release build for PatchMan desktop: signed + notarized DMG + updater .sig.
#
# Run from the repo root (npm scripts resolve relative to package.json). The version in
# package.json / tauri.conf.json / Cargo.toml must already be bumped and the
# changelog updated — this script only does the build/sign/notarize/stage
# half of the release process.
#
# Usage:   bash scripts/release-build.sh   (from the repository root)
#
# Required env (macOS notarization):
#   APPLE_ID        Apple Developer Apple ID email
#   APPLE_PASSWORD  app-specific password (NOT the Apple ID password)
#   APPLE_TEAM_ID   Your Apple Developer Team ID
#
# Optional env (auto-resolved when omitted):
#   TAURI_SIGNING_PRIVATE_KEY           updater key contents
#                                       — defaults to `cat src-tauri/.keys/patchman.key`
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  defaults to "" (set it if your key has a password)
#   PATCHMAN_DOWNLOAD_BASE_URL          public URL where staged artifacts are hosted
#                                       (written into latest.json)

set -euo pipefail

# Resolve fe/ no matter where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$FE_DIR"

red()    { printf "\033[31m%s\033[0m\n" "$*" >&2; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

# 1. Notarization env — hard requirement. Without these, stage-desktop.mjs
#    silently skips DMG notarization and users hit Gatekeeper on first open.
missing=()
for v in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if (( ${#missing[@]} > 0 )); then
  red "Missing required env: ${missing[*]}"
  red "Notarization needs all three set."
  exit 2
fi

# 2. Updater signing key. Tauri build emits the .app.tar.gz.sig only when both
#    TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD are set
#    in the environment at build time. With only the key, tauri tries to
#    prompt on /dev/tty and dies with "Device not configured (os error 6)".
KEY_FILE="$FE_DIR/src-tauri/.keys/patchman.key"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ ! -f "$KEY_FILE" ]]; then
    red "TAURI_SIGNING_PRIVATE_KEY unset and $KEY_FILE not found."
    red "The updater .sig won't be produced without it."
    exit 2
  fi
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
fi
# An empty password is valid for a key generated without one — set it
# explicitly so tauri doesn't try to prompt.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}"

VERSION="$(node -p "require('./package.json').version")"
green "→ Building PatchMan $VERSION (signed + notarized)"
yellow "  APPLE_ID=${APPLE_ID}  TEAM=${APPLE_TEAM_ID}  KEY=$([[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]] && echo set || echo MISSING)"

# 3. The actual build. tauri:build chains:
#    sidecar:build (Go binary for the embedded BE)
#    → tauri build (Rust shell, sign .app + notarize .app + bundle DMG)
#    → desktop:stage (notarize + staple DMG, copy to public/downloads/,
#                     refresh latest.json + .app.tar.gz + .sig)
#    The sidecar is built once up front and gated first: it must bind its port
#    with an unread stdout pipe (1.58.0 launch crash). tauri:build rebuilds it
#    from the Go cache, so the extra build costs seconds.
npm run sidecar:build
bash "$SCRIPT_DIR/check-sidecar-boot.sh"
npm run tauri:build

# 4. Post-build sanity. The most insidious failure mode here is a "successful"
#    build that silently skipped the .sig or the notarization — surface that
#    up front instead of letting it ship.
DL_DIR="$FE_DIR/public/downloads"
DMG="$DL_DIR/PatchMan-latest.dmg"
SIG="$DL_DIR/PatchMan-latest.app.tar.gz.sig"
LATEST_JSON="$DL_DIR/latest.json"

fail=0
if [[ ! -f "$DMG" ]]; then
  red "✗ $DMG missing after build"
  fail=1
fi
if [[ ! -f "$SIG" ]]; then
  red "✗ $SIG missing — updater won't auto-install."
  red "  Almost always TAURI_SIGNING_PRIVATE_KEY_PASSWORD wasn't set (it must be exported, even when empty)."
  fail=1
fi
if [[ -f "$LATEST_JSON" ]]; then
  JSON_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$LATEST_JSON','utf8')).version" 2>/dev/null || echo "")"
  if [[ "$JSON_VERSION" != "$VERSION" ]]; then
    red "✗ latest.json version ($JSON_VERSION) ≠ package.json ($VERSION)"
    fail=1
  fi
fi

if (( fail > 0 )); then
  exit 1
fi

green "✓ Build complete — $VERSION signed, notarized, staged at $DL_DIR"
green "  Next: upload the staged artifacts to the location behind PATCHMAN_DOWNLOAD_BASE_URL."
