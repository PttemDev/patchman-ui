import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'node:child_process'

// Resolve the current git commit at build time so crash reports baked
// into the bundle can identify exactly which build a user is on. Falls
// back to "unknown" when not in a git checkout (e.g. published archives).
function resolveBuildCommit(): string {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Compile-time constants. The crash reporter reads these to attach
  // build identity to every Slack message — version comes from
  // package.json (already exposed via @/lib/version), commit comes from
  // here, env from Vite's MODE.
  define: {
    __BUILD_COMMIT__: JSON.stringify(resolveBuildCommit()),
  },
  // jq-web is an Emscripten module that loads its own WASM; letting esbuild
  // pre-bundle it mangles that loading in dev. Exclude it so it's served as-is
  // (we hand it the wasm bytes explicitly via `wasmBinary`).
  optimizeDeps: {
    exclude: ['jq-web'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8085',
        ws: true,
      },
      '/mock': 'http://localhost:8085',
    },
  },
})
