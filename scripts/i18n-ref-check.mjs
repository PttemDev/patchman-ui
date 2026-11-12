#!/usr/bin/env node
// i18n reference check — for every t('ns:key') / t('key') / i18nKey="key" in the
// component tree, confirm the key exists in en/<ns>.json (English source). A
// missing key renders as the raw key string in the UI (broken-looking), so this
// catches components an interrupted agent converted before finishing en.json.
// Dynamic keys (template literals with ${}) are counted separately, not failed.
//
// Usage: node scripts/i18n-ref-check.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');
const LOCALES = join(ROOT, 'i18n', 'locales');

function flatten(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = true;
  }
  return out;
}
const enCache = {};
function enKeys(ns) {
  if (ns in enCache) return enCache[ns];
  try {
    enCache[ns] = flatten(JSON.parse(readFileSync(join(LOCALES, 'en', `${ns}.json`), 'utf8')));
  } catch {
    enCache[ns] = null; // no en file for this namespace
  }
  return enCache[ns];
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (!['i18n'].includes(n)) walk(p, out); }
    else if (n.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'components'));
try { statSync(join(ROOT, 'App.tsx')) && files.push(join(ROOT, 'App.tsx')); } catch {}

const KEY_RE = /(?:\bt\(\s*|i18nKey\s*=\s*)(['"])([^'"]+)\1/g;
const DEFNS_RE = /useTranslation\(\s*['"]([^'"]+)['"]/;

const missingByNs = new Map(); // ns -> [{file, key}]
let dynamicCount = 0, noEnNs = new Set();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const defNs = (src.match(DEFNS_RE) || [])[1] || null;
  // Note template-literal t(`...`) as dynamic (skip precise check).
  dynamicCount += (src.match(/\bt\(\s*`/g) || []).length;
  let m;
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(src))) {
    const raw = m[2];
    if (raw.includes('${') || raw.includes('{{')) continue;
    let ns, key;
    if (raw.includes(':')) { [ns, key] = [raw.slice(0, raw.indexOf(':')), raw.slice(raw.indexOf(':') + 1)]; }
    else { ns = defNs; key = raw; }
    if (!ns) continue; // t() with no resolvable ns (rare) — skip
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) continue; // not a plain key literal
    const ek = enKeys(ns);
    if (ek === null) { noEnNs.add(ns); continue; } // handled elsewhere (no en file)
    if (!ek[key]) {
      if (!missingByNs.has(ns)) missingByNs.set(ns, []);
      missingByNs.get(ns).push({ file: relative(ROOT, file), key });
    }
  }
}

console.log('\n=== i18n reference check (t() keys missing from en/<ns>.json) ===\n');
if (missingByNs.size === 0) {
  console.log('All resolvable t() references exist in their en namespace. ✓');
} else {
  for (const [ns, list] of [...missingByNs.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`[${ns}]  ${list.length} missing`);
    for (const { file, key } of list.slice(0, 15)) console.log(`    ${file}  →  ${key}`);
    if (list.length > 15) console.log(`    … +${list.length - 15} more`);
  }
}
if (noEnNs.size) console.log(`\nNote — refs to namespaces with NO en file (component converted, en.json absent): ${[...noEnNs].join(', ')}`);
console.log(`\n(${dynamicCount} dynamic t(\`…\`) template refs not statically checked)\n`);
