#!/usr/bin/env node
// i18n coverage scanner — finds user-facing strings NOT routed through t().
// Two buckets:
//   (A) files with NO useTranslation import           → fully un-internationalized
//   (B) files WITH useTranslation but residual literals → partial coverage
// Heuristic (noisy by design — maps the work, agents verify each hit):
//   - JSX text nodes:  >Some Text<
//   - literal attrs:   placeholder|title|aria-label|alt|label|tooltip|description="..."
//   - toasts/alerts:   toast.x('...'), toast('...'), alert('...')
//
// Usage: node scripts/i18n-coverage-scan.mjs [--dir=components/git] [--full]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const dirFilter = (args.find((a) => a.startsWith('--dir=')) || '').slice(6);

// Dirs whose text is not user-facing or is intentionally verbatim.
const SKIP_DIRS = new Set(['ui', 'icons']);
// Namespaces already driven to coverage — still scanned (residuals happen)
// but tagged so the report separates "known partial" from "untouched".
const DONE_HINTS = ['components/layout', 'components/auth', 'components/settings', 'components/response', 'components/request'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

// Strip line/block comments crudely so commented-out JSX isn't flagged.
function decomment(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ATTR_RE = /\b(placeholder|title|aria-label|alt|label|tooltip|description|emptyText|confirmText|cancelText)\s*=\s*"([^"]*[A-Za-z]{2,}[^"]*)"/g;
const TOAST_RE = /\b(?:toast(?:\.\w+)?|sonnerToast|notify|window\.alert|alert)\(\s*(['"])([^'"]{2,})\1/g;
const JSXTEXT_RE = />[\t ]*([^<>{}\n][^<>{}\n]*?)[\t ]*</g;

// Reject captures that are clearly not UI copy.
function isUiText(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-zÀ-ɏ一-鿿]{2,}/.test(t)) return false; // needs a word
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && t.length <= 3) return false; // stray idents like "px"
  if (/^\s*(https?:|www\.|\/|#|\.|@)/.test(t)) return false; // urls/paths/handles
  if (/^[A-Z0-9_]+$/.test(t)) return false; // CONSTANT_CASE enum-ish
  if (/[{}$`]/.test(t)) return false;
  // Reject JS/JSX expression fragments the >…< matcher catches inside code
  // (e.g. "= 200 && item.statusCode", "x >= 15", "a === b").
  if (/^[=<>!]/.test(t)) return false;
  if (/(&&|\|\||===|!==|>=|<=|=>)/.test(t)) return false;
  return true;
}

// Attribute values that are non-UI (types, modes, css) even though literal.
function isUiAttr(name, val) {
  if (!isUiText(val)) return false;
  if (name === 'title' && /^[a-z-]+$/.test(val.trim())) return false; // e.g. title="button"
  return true;
}

const files = (dirFilter ? walk(join(ROOT, dirFilter)) : walk(join(ROOT, 'components')))
  .concat(dirFilter ? [] : ['App.tsx'].map((f) => join(ROOT, f)).filter((f) => { try { statSync(f); return true; } catch { return false; } }));

const report = []; // {file, hasT, hits: [{line, kind, text}]}
for (const file of files.sort()) {
  const raw = readFileSync(file, 'utf8');
  const hasT = /useTranslation|<Trans[\s>]|i18n\.t\(|\bt\(['"]/.test(raw);
  const src = decomment(raw);
  const lines = src.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    // Skip import lines and obvious non-UI.
    if (/^\s*import\b/.test(line)) return;
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(line))) if (isUiAttr(m[1], m[2])) hits.push({ line: i + 1, kind: m[1], text: m[2] });
    TOAST_RE.lastIndex = 0;
    while ((m = TOAST_RE.exec(line))) if (isUiText(m[2])) hits.push({ line: i + 1, kind: 'toast', text: m[2] });
    JSXTEXT_RE.lastIndex = 0;
    while ((m = JSXTEXT_RE.exec(line))) if (isUiText(m[1])) hits.push({ line: i + 1, kind: 'jsx', text: m[1].trim() });
  });
  if (hits.length) report.push({ file: relative(ROOT, file), hasT, hits });
}

// Group by top-level component dir.
const byDir = new Map();
for (const r of report) {
  const dir = r.file.split('/').slice(0, 2).join('/');
  if (!byDir.has(dir)) byDir.set(dir, { files: 0, hits: 0, noT: 0, partial: 0 });
  const g = byDir.get(dir);
  g.files++;
  g.hits += r.hits.length;
  if (r.hasT) g.partial++; else g.noT++;
}

console.log('\n=== i18n coverage gaps by directory (suspected hardcoded UI strings) ===\n');
const dirs = [...byDir.entries()].sort((a, b) => b[1].hits - a[1].hits);
for (const [dir, g] of dirs) {
  const done = DONE_HINTS.some((h) => dir.startsWith(h)) ? '  [wave-done]' : '';
  console.log(`${dir.padEnd(30)}  ${String(g.hits).padStart(4)} hits  ·  ${g.files} files (${g.noT} no-t, ${g.partial} partial)${done}`);
}
const totals = report.reduce((a, r) => ({ hits: a.hits + r.hits.length, noT: a.noT + (r.hasT ? 0 : 1), partial: a.partial + (r.hasT ? 1 : 0) }), { hits: 0, noT: 0, partial: 0 });
console.log(`\nTOTAL: ${totals.hits} suspected strings across ${report.length} files (${totals.noT} fully un-i18n'd, ${totals.partial} partial)\n`);

if (FULL) {
  console.log('=== detail ===\n');
  for (const r of report.sort((a, b) => b.hits.length - a.hits.length)) {
    console.log(`\n${r.file}  ${r.hasT ? '(partial)' : '(NO useTranslation)'} — ${r.hits.length}`);
    for (const h of r.hits.slice(0, 40)) console.log(`  L${h.line} [${h.kind}] ${h.text}`);
    if (r.hits.length > 40) console.log(`  … +${r.hits.length - 40} more`);
  }
}
