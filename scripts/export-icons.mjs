#!/usr/bin/env node
/**
 * Rasterize the master SVGs to the PNG / ICO / ICNS sizes the desktop
 * builder and stores expect, write them under `src-tauri/icons/` (the
 * directory `tauri.conf.json` points at), and also drop a 32x32 PNG
 * favicon in `public/` for browsers that don't accept SVG.
 *
 * Run once after editing `src/assets/brand/patchman-app-icon.svg` or
 * `public/favicon.svg`:
 *
 *   node scripts/export-icons.mjs
 *
 * Dependencies (zero runtime cost; only needed when (re)generating):
 *   - sharp: PNG rasterization at arbitrary sizes
 *   - png2icons: produces `.icns` (macOS) + `.ico` (Windows) from PNG
 *
 * Both are devDependencies — if missing, the script prints an install
 * hint and exits non-zero rather than failing inside an unrelated build.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APP_SVG = path.join(REPO, 'src/assets/brand/patchman-app-icon.svg');
const FAV_SVG = path.join(REPO, 'public/favicon.svg');
const ICONS_DIR = path.join(REPO, 'src-tauri/icons');
const PUBLIC_DIR = path.join(REPO, 'public');

async function loadDeps() {
  try {
    const sharp = (await import('sharp')).default;
    const png2icons = await import('png2icons');
    return { sharp, png2icons };
  } catch (err) {
    console.error(
      'Missing rasterizer dependencies. Install once with:\n' +
        '  npm i -D sharp png2icons\n' +
        '(' + (err instanceof Error ? err.message : String(err)) + ')',
    );
    process.exit(1);
  }
}

// Tauri's macOS bundler reads these specific filenames out of icons/.
// Windows Store builds use the Square*Logo set; we generate them from
// the same source so the visual stays consistent across platforms.
const PNG_TARGETS = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 1024 },
  { name: 'Square30x30Logo.png', size: 30 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'Square71x71Logo.png', size: 71 },
  { name: 'Square89x89Logo.png', size: 89 },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png', size: 50 },
];

async function main() {
  const { sharp, png2icons } = await loadDeps();
  const appSvg = await fs.readFile(APP_SVG);
  const favSvg = await fs.readFile(FAV_SVG);

  // Rasterize every PNG target.
  for (const t of PNG_TARGETS) {
    const out = path.join(ICONS_DIR, t.name);
    await sharp(appSvg, { density: 600 })
      .resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`[icons] ${t.name} (${t.size}px)`);
  }

  // The macOS `.icns` and Windows `.ico` containers expect a pre-rasterized
  // 1024 PNG input. We just rasterized icon.png so re-read it.
  const icon1024 = await fs.readFile(path.join(ICONS_DIR, 'icon.png'));
  const icns = png2icons.createICNS(icon1024, png2icons.BILINEAR, 0);
  if (icns) await fs.writeFile(path.join(ICONS_DIR, 'icon.icns'), icns);
  const ico = png2icons.createICO(icon1024, png2icons.BILINEAR, 0, false);
  if (ico) await fs.writeFile(path.join(ICONS_DIR, 'icon.ico'), ico);
  console.log('[icons] icon.icns + icon.ico');

  // Browser favicons: keep favicon.svg as the source of truth, but also
  // emit 16/32 PNG fallbacks for browsers that don't pick up SVG.
  for (const size of [16, 32]) {
    const out = path.join(PUBLIC_DIR, `favicon-${size}.png`);
    await sharp(favSvg, { density: 600 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`[icons] favicon-${size}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
