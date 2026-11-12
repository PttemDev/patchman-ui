#!/usr/bin/env node
// Resolve which Tauri config files to use at build time.
//
// The committed `tauri.conf.json` carries no tenant-specific values
// (updater endpoint, code-signing identity, public key). A per-deployment
// overlay lives in `src-tauri/tauri.tenant.json` — gitignored, populated
// from `tauri.tenant.json.example`. When that file is present we tell
// the Tauri CLI to layer it on top of the base config via `--config`.
//
// Stdout is the additional CLI args to splice into the `tauri` command,
// or empty when no overlay exists. The npm script wraps this with `$()`.

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const overlay = resolve(here, '..', 'src-tauri', 'tauri.tenant.json');

if (existsSync(overlay)) {
  process.stdout.write(`--config ${overlay}`);
} else {
  // No overlay — base config is used verbatim. Builds without tenant
  // values will fail at sign / updater time, which is the desired loud
  // failure (versus silently shipping a broken bundle).
  process.stdout.write('');
}
