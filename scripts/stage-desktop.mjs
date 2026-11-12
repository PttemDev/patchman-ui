#!/usr/bin/env node
// Stage desktop artifacts into `public/downloads/` so the web build serves
// them. Vite passes `public/` through to `dist/` at build time, and the
// Dockerfile copies `dist/` into the runtime image — so whatever is staged
// here when `docker build` runs becomes what users download.
//
// What gets staged:
//   DMG (user-facing installer):
//     PatchMan-<version>-<arch>.dmg      ← version-pinned
//     PatchMan-latest.dmg                ← stable URL the badge uses
//
//   Updater artifacts (consumed by @tauri-apps/plugin-updater):
//     PatchMan-latest.app.tar.gz         ← packed .app bundle
//     PatchMan-latest.app.tar.gz.sig     ← minisign/Ed25519 signature
//     latest.json                        ← manifest the updater polls
//
// Signing prerequisite:
//   Tauri generates the `.sig` file during `tauri build` only if
//   `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
//   if the key is encrypted) are exported in the environment. The private
//   key lives at `fe/src-tauri/.keys/patchman.key` (gitignored) — export
//   like so before `npm run tauri:build`:
//
//     export TAURI_SIGNING_PRIVATE_KEY="$(cat fe/src-tauri/.keys/patchman.key)"
//
//   Missing sig file → this script warns and skips updater staging, so you
//   get a DMG-only build. The web app will still work; only auto-update is
//   affected.
//
// Missing DMG is a hard error — if you only built the .app and skipped
// bundling, re-run `npm run tauri:build` (or `tauri build --bundles dmg`).

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const feDir = resolve(here, '..');
const pkg = JSON.parse(readFileSync(resolve(feDir, 'package.json'), 'utf-8'));
const version = pkg.version;

const bundleDir = resolve(feDir, 'src-tauri', 'target', 'release', 'bundle');
const dmgDir = resolve(bundleDir, 'dmg');
const macosDir = resolve(bundleDir, 'macos');
const outDir = resolve(feDir, 'public', 'downloads');

// ---------- DMG staging ----------

if (!existsSync(dmgDir)) {
  throw new Error(
    `No DMG output dir at ${dmgDir}. Run \`npm run tauri:build\` first.`,
  );
}

// Tauri names its DMG `PatchMan_<version>_<arch>.dmg`. Find the one matching
// the current version — if there are multiple (e.g. stale from an older
// run), prefer the newest mtime.
const dmgCandidates = readdirSync(dmgDir)
  .filter((f) => f.startsWith(`PatchMan_${version}_`) && f.endsWith('.dmg'))
  .map((f) => ({ f, path: join(dmgDir, f), mtime: statSync(join(dmgDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (dmgCandidates.length === 0) {
  throw new Error(
    `No DMG matching version ${version} in ${dmgDir}. Tauri built a DMG with a different version — did you forget to bump package.json / Cargo.toml / tauri.conf.json together?`,
  );
}

const { path: dmgSrc, f: dmgSrcName } = dmgCandidates[0];

// Tauri notarizes the .app inside the DMG but not the DMG wrapper itself, so
// first-open via Finder still shows a "cannot be opened" prompt. Submit the
// DMG to notarytool and staple the ticket before staging — once done, the
// download works in one click with no Gatekeeper friction.
const { APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID } = process.env;
const canNotarize = APPLE_ID && APPLE_PASSWORD && APPLE_TEAM_ID;

if (canNotarize) {
  const needsStaple = spawnSync('xcrun', ['stapler', 'validate', dmgSrc], { stdio: 'pipe' }).status !== 0;
  if (needsStaple) {
    console.log(`[stage-desktop] Notarizing ${dmgSrcName}…`);
    const submit = spawnSync(
      'xcrun',
      ['notarytool', 'submit', dmgSrc, '--apple-id', APPLE_ID, '--password', APPLE_PASSWORD, '--team-id', APPLE_TEAM_ID, '--wait'],
      { stdio: 'inherit' },
    );
    if (submit.status !== 0) {
      throw new Error(`[stage-desktop] notarytool submit failed (exit ${submit.status})`);
    }
    const staple = spawnSync('xcrun', ['stapler', 'staple', dmgSrc], { stdio: 'inherit' });
    if (staple.status !== 0) {
      throw new Error(`[stage-desktop] stapler staple failed (exit ${staple.status})`);
    }
  } else {
    console.log(`[stage-desktop] DMG already stapled, skipping notarize.`);
  }
} else {
  console.warn('[stage-desktop] APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID missing — skipping DMG notarization. Users will see a Gatekeeper prompt on first open.');
}

// Extract arch suffix from the Tauri filename: PatchMan_1.0.1_aarch64.dmg → aarch64
const archMatch = dmgSrcName.match(/PatchMan_.*?_(.+)\.dmg$/);
const arch = archMatch?.[1] ?? 'unknown';

const versionedDmgName = `PatchMan-${version}-${arch}.dmg`;
const latestDmgName = `PatchMan-latest.dmg`;

mkdirSync(outDir, { recursive: true });
copyFileSync(dmgSrc, resolve(outDir, versionedDmgName));
copyFileSync(dmgSrc, resolve(outDir, latestDmgName));

console.log(`[stage-desktop] Copied ${dmgSrcName} → public/downloads/`);
console.log(`[stage-desktop]   ${versionedDmgName}`);
console.log(`[stage-desktop]   ${latestDmgName}`);

// ---------- Updater artifact staging ----------
//
// Tauri writes `.app.tar.gz` and `.app.tar.gz.sig` into target/release/bundle/macos
// when `createUpdaterArtifacts: true` is set and `TAURI_SIGNING_PRIVATE_KEY`
// was in the env at build time. Pick up both, copy them to public/downloads/,
// and write a `latest.json` pointing at the stable URL.

if (!existsSync(macosDir)) {
  console.warn(`[stage-desktop] No macOS bundle dir at ${macosDir} — skipping updater staging.`);
  process.exit(0);
}

const tarCandidates = readdirSync(macosDir)
  .filter((f) => f.endsWith('.app.tar.gz'))
  .map((f) => ({ f, path: join(macosDir, f), mtime: statSync(join(macosDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (tarCandidates.length === 0) {
  console.warn('[stage-desktop] No .app.tar.gz in macos bundle dir — skipping updater staging. Set TAURI_SIGNING_PRIVATE_KEY and rebuild to enable auto-updates.');
  process.exit(0);
}

const { path: tarSrc, f: tarSrcName } = tarCandidates[0];
const sigSrc = `${tarSrc}.sig`;

if (!existsSync(sigSrc)) {
  console.warn(`[stage-desktop] Missing signature ${sigSrc} — skipping updater staging. Export TAURI_SIGNING_PRIVATE_KEY before \`npm run tauri:build\` so Tauri produces the .sig.`);
  process.exit(0);
}

const signature = readFileSync(sigSrc, 'utf-8').trim();

// Tauri's update plugin identifies platforms as `<os>-<arch>`:
//   aarch64 → darwin-aarch64  (Apple Silicon)
//   x86_64  → darwin-x86_64   (Intel)
const platformKey = arch === 'aarch64' ? 'darwin-aarch64' : `darwin-${arch}`;

const latestTarName = 'PatchMan-latest.app.tar.gz';
const latestSigName = 'PatchMan-latest.app.tar.gz.sig';
const latestJsonName = 'latest.json';

copyFileSync(tarSrc, resolve(outDir, latestTarName));
copyFileSync(sigSrc, resolve(outDir, latestSigName));

// Public URL the desktop updater polls. Set PATCHMAN_DOWNLOAD_BASE_URL to the
// location where you host the staged artifacts, and keep it in sync with
// tauri.conf.json → plugins.updater.endpoints. The default is a placeholder.
const publicBase = (
  process.env.PATCHMAN_DOWNLOAD_BASE_URL || 'https://downloads.example.com/patchman'
).replace(/\/+$/, '');

const notes = pkg.updaterNotes ?? `PatchMan ${version}`;
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey]: {
      signature,
      url: `${publicBase}/${latestTarName}`,
    },
  },
};

writeFileSync(resolve(outDir, latestJsonName), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`[stage-desktop] Copied ${tarSrcName} + .sig → public/downloads/`);
console.log(`[stage-desktop]   ${latestTarName}`);
console.log(`[stage-desktop]   ${latestSigName}`);
console.log(`[stage-desktop]   ${latestJsonName} (${platformKey} → ${version})`);
