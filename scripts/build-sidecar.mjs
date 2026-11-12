#!/usr/bin/env node
// Build the Go BE as Tauri sidecar binaries.
//
// Tauri v2 resolves sidecar binaries by target-triple suffix:
//   src-tauri/binaries/<name>-<rustc-target-triple>
//
// We build TWO entrypoints, each arch-suffixed the same way:
//   patchman-server  (./cmd/server)     — the embedded backend
//   patchman-mcp     (./cmd/mcp-bridge)  — the local-MCP stdio bridge
//
// We detect the host triple with `rustc -vV` and hand that to Go's cross-
// compiler (via GOOS/GOARCH). Running this before `tauri dev` or `tauri build`
// keeps the binaries fresh without forcing devs to remember the exact path.

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const feDir = resolve(here, '..');
const repoRoot = resolve(feDir, '..');
// Where the Go backend (the patchman-api repository) lives. Override with
// PATCHMAN_API_DIR; by default we look for a sibling checkout next to this
// repository, then for a legacy ../be layout.
const beDir = resolve(
  process.env.PATCHMAN_API_DIR ||
    [resolve(repoRoot, 'patchman-api'), resolve(repoRoot, 'be')].find((p) => existsSync(p)) ||
    resolve(repoRoot, 'patchman-api'),
);
const outDir = resolve(feDir, 'src-tauri', 'binaries');

function rustcTargetTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf8' });
  const m = out.match(/host:\s*(\S+)/);
  if (!m) throw new Error('Could not parse rustc host triple from:\n' + out);
  return m[1];
}

// Mapping rustc-style triple → Go GOOS/GOARCH. Keep to the triples we support.
function goEnvFor(triple) {
  const table = {
    'aarch64-apple-darwin': { GOOS: 'darwin', GOARCH: 'arm64' },
    'x86_64-apple-darwin':  { GOOS: 'darwin', GOARCH: 'amd64' },
    'x86_64-unknown-linux-gnu':  { GOOS: 'linux', GOARCH: 'amd64' },
    'aarch64-unknown-linux-gnu': { GOOS: 'linux', GOARCH: 'arm64' },
    'x86_64-pc-windows-msvc':    { GOOS: 'windows', GOARCH: 'amd64' },
    'x86_64-pc-windows-gnu':     { GOOS: 'windows', GOARCH: 'amd64' },
  };
  const entry = table[triple];
  if (!entry) throw new Error(`Unsupported target triple: ${triple}`);
  return entry;
}

const triple = rustcTargetTriple();
const exeSuffix = triple.includes('windows') ? '.exe' : '';

if (!existsSync(beDir)) {
  throw new Error(
    `Backend directory not found: ${beDir}\n` +
      'Clone the patchman-api repository next to this one, or set PATCHMAN_API_DIR to its path.',
  );
}
mkdirSync(outDir, { recursive: true });

const env = { ...process.env, CGO_ENABLED: '0', ...goEnvFor(triple) };

// Stamp the app version into the discovery file the server writes. Read it
// from tauri.conf.json so it stays aligned with the bundle. `-X` on the
// bridge entrypoint (no such symbol) is a harmless linker no-op.
let appVersion = 'dev';
try {
  const conf = JSON.parse(readFileSync(resolve(feDir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  if (conf.version) appVersion = conf.version;
} catch {
  // keep "dev"
}

// Both entrypoints, arch-suffixed. patchman-mcp is bundled as a second
// externalBin (see tauri.conf.json) so it ships in the .app beside the
// server; the embedded BE copies it to a stable path on startup.
const builds = [
  { entry: './cmd/server', name: 'patchman-server' },
  { entry: './cmd/mcp-bridge', name: 'patchman-mcp' },
];

console.log(`[sidecar] GOOS=${env.GOOS} GOARCH=${env.GOARCH} version=${appVersion}`);
for (const { entry, name } of builds) {
  const outName = `${name}-${triple}${exeSuffix}`;
  const outPath = resolve(outDir, outName);
  console.log(`[sidecar] Building ${outName}`);
  const result = spawnSync(
    'go',
    ['build', '-trimpath', `-ldflags=-s -w -X main.buildVersion=${appVersion}`, '-o', outPath, entry],
    { cwd: beDir, stdio: 'inherit', env },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(`[sidecar] Wrote ${outPath}`);
}
