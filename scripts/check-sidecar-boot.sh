#!/usr/bin/env bash
# Release gate: the embedded sidecar must bind its port even when nobody reads
# its stdout/stderr.
#
# Guards the 1.58.0 launch crash: the sidecar wrote ~65 KB (gin's debug route
# listing) to stdout before binding, the desktop shell wasn't draining the
# pipe, the 64 KiB pipe buffer filled, the sidecar blocked mid-write, boot
# timed out and the app aborted on every launch. The shell drains the pipe
# now (src-tauri/src/lib.rs drain_sidecar_events); this keeps the BE side
# honest too.
#
# Usage:   bash scripts/check-sidecar-boot.sh [path/to/patchman-server]
#          (defaults to the freshly built src-tauri/binaries sidecar)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
BIN="${1:-$FE_DIR/src-tauri/binaries/patchman-server-$TRIPLE}"

if [[ ! -x "$BIN" ]]; then
  echo "✗ sidecar binary not found: $BIN" >&2
  exit 2
fi

TMP="$(mktemp -d)"
PORT="$(python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"

cleanup() {
  pkill -f "bind 127.0.0.1:$PORT" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# env -i: an inherited GIN_MODE=release (the user-side 1.58.0 workaround)
# would hide the regression. stdout+stderr go into a pipe nobody reads.
( env -i HOME="$TMP/home" PATH=/usr/bin:/bin "$BIN" \
    --mode embedded --db-driver sqlite --db-path "$TMP/check.db" \
    --bind "127.0.0.1:$PORT" 2>&1 | sleep 30 ) &

for i in $(seq 1 100); do
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    echo "✓ sidecar binds with undrained stdout (~$((i * 100)) ms)"
    exit 0
  fi
  sleep 0.1
done

echo "✗ sidecar did not bind 127.0.0.1:$PORT within 10s while its stdout was not read" >&2
echo "  Something writes too much before net.Listen (gin debug mode?)." >&2
exit 1
