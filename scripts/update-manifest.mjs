#!/usr/bin/env node
// Adds platform entries to the updater manifest (latest.json) of a GitHub
// Release, keeping the entries other builds already wrote.
//
// The desktop app's updater (tauri.conf.json → plugins.updater) polls
//   https://github.com/<repo>/releases/latest/download/latest.json
// and picks `<os>-<arch>-<installer>` (e.g. windows-x86_64-nsis), falling back
// to `<os>-<arch>`. The macOS build runs on the maintainer's Mac and the
// Windows/Linux builds run in CI, so each side merges its own entries into
// the same file.
//
// Usage:
//   node scripts/update-manifest.mjs <latest.json> <version> <key>=<file> [<key>=<file> ...]
//
// <file> is the update package as it is named on the release; its signature
// is read from <file>.sig next to it. macOS has one package type, so its key
// is also written as the plain `darwin-<arch>` fallback. Windows and Linux get
// none on purpose: an MSI or .deb install must never fall back to the NSIS
// installer or the AppImage. An existing
// <latest.json> is updated in place (entries for other keys are kept; a
// different version starts from scratch). Set RELEASE_NOTES to override the
// notes text.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [out, version, ...pairs] = process.argv.slice(2);
if (!out || !version || pairs.length === 0) {
  console.error('usage: update-manifest.mjs <latest.json> <version> <key>=<file> ...');
  process.exit(2);
}

const repo = process.env.GITHUB_REPOSITORY || 'PttemDev/patchman-ui';
const tag = `v${version}`;

let manifest = { version, notes: '', pub_date: '', platforms: {} };
if (existsSync(out)) {
  const prev = JSON.parse(readFileSync(out, 'utf8'));
  if (prev.version === version) manifest = { ...manifest, ...prev, platforms: { ...prev.platforms } };
}
manifest.notes = process.env.RELEASE_NOTES || manifest.notes || `PatchMan ${version}`;
manifest.pub_date = new Date().toISOString();

const fallbackSet = new Set();
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  if (eq < 1) throw new Error(`bad argument: ${pair}`);
  const key = pair.slice(0, eq);
  const file = pair.slice(eq + 1);
  const sigFile = `${file}.sig`;
  if (!existsSync(sigFile)) throw new Error(`missing signature: ${sigFile}`);
  const entry = {
    signature: readFileSync(sigFile, 'utf8').trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(file))}`,
  };
  manifest.platforms[key] = entry;
  const base = key.split('-').slice(0, 2).join('-');
  if (key.startsWith('darwin-') && base !== key && !fallbackSet.has(base)) {
    manifest.platforms[base] = entry;
    fallbackSet.add(base);
  }
  console.log(`[update-manifest] ${key} → ${entry.url}`);
}

writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
