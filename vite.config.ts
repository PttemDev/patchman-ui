import { defineConfig, type Plugin } from 'vite'
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

// Excalidraw lists a CDN copy (esm.sh) after every local font URL. The app
// ships the fonts in /excalidraw-assets/ (excalidrawSetup.ts), the desktop
// CSP has no esm.sh in font-src, and offline-first means no CDN: point the
// fallback at the same local folder so no font URL ever names esm.sh.
function excalidrawLocalFontFallback(): Plugin {
  const re = /(ASSETS_FALLBACK_URL",\s*)`https:\/\/esm\.sh\/.*?\/dist\/(?:prod|dev)\/`/
  return {
    name: 'patchman-excalidraw-local-fonts',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('@excalidraw/excalidraw/dist/') || !code.includes('ASSETS_FALLBACK_URL')) return null
      const out = code.replace(re, '$1(typeof window!=="undefined"?window.location.origin:"http://localhost")+"/excalidraw-assets/"')
      if (out === code) this.warn('Excalidraw font fallback URL not found — CDN fallback left in place')
      return out === code ? null : { code: out, map: null }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), excalidrawLocalFontFallback()],
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
