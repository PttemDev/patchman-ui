#!/usr/bin/env node
// i18n length audit — flags translations that are much LONGER than the English
// source, focused on short strings (buttons / tabs / labels / placeholders)
// where overflow breaks layout. Long prose (en > PROSE_MIN) is ignored: it
// lives in areas that wrap fine. zh is reported but rarely a width risk (CJK
// translations use fewer characters), so tr/es drive the flags.
//
// Usage: node scripts/i18n-length-audit.mjs [--all] [--ns=settings]
//   default: only "short-en" layout-risk candidates, ranked by worst delta.
//   --all: dump every key's lengths.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, '..', 'src', 'i18n', 'locales');
const SRC = 'en';
const TARGETS = ['tr', 'es', 'zh'];

// A string counts as "short / layout-sensitive" when the English is at most
// this many chars (buttons, tabs, nav, placeholders, badges).
const SHORT_EN = 32;
// Ignore anything whose English is clearly prose.
const PROSE_MIN = 60;

const args = process.argv.slice(2);
const ALL = args.includes('--all');
// --wide shows every short-en risk (incl. prose); default focuses on the
// layout-tight categories the user cares about: buttons, tabs/nav, placeholders.
const WIDE = args.includes('--wide');
const nsFilter = (args.find((a) => a.startsWith('--ns=')) || '').slice(5);

// Categorise a key by its name/path so we can keep only layout-tight strings
// (fixed-width buttons, tabs, nav, input placeholders) and drop prose that
// wraps fine (tooltips, descriptions, toasts, errors, hints).
const PROSE_RE = /(description|tooltip|hint|subtitle|error|failed|help\b|note|detail|pitch|\binfo\b|message|msg|empty|coming|warn|placeholderHint|heading|title|reach|pill|status|desc)/i;
const PLACEHOLDER_RE = /placeholder/i;
const TABNAV_RE = /(^|\.)(tabs?|nav)\./i;
function categorise(key, enLen) {
  if (PLACEHOLDER_RE.test(key)) return 'PLACEHOLDER';
  if (TABNAV_RE.test(key)) return 'TAB/NAV';
  if (PROSE_RE.test(key)) return 'prose';
  if (enLen <= 24) return 'BUTTON/LABEL';
  return 'prose';
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function load(lng, ns) {
  try {
    return flatten(JSON.parse(readFileSync(join(LOCALES, lng, `${ns}.json`), 'utf8')));
  } catch {
    return null;
  }
}

const namespaces = [...new Set(
  readdirSync(join(LOCALES, SRC)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')),
)].filter((ns) => !nsFilter || ns === nsFilter);

const rows = [];
for (const ns of namespaces) {
  const en = load(SRC, ns);
  if (!en) continue;
  const t = Object.fromEntries(TARGETS.map((lng) => [lng, load(lng, ns)]));
  for (const [key, enVal] of Object.entries(en)) {
    const enLen = enVal.length;
    for (const lng of TARGETS) {
      const val = t[lng]?.[key];
      if (typeof val !== 'string') continue;
      const len = val.length;
      const delta = len - enLen;
      const ratio = enLen ? len / enLen : 1;
      const shortEn = enLen <= SHORT_EN && enLen < PROSE_MIN;
      // zh: down-weight — a longer zh by char count is usually still narrower.
      const risky = lng === 'zh' ? delta >= 8 && ratio >= 1.3 : delta >= 5 && ratio >= 1.3;
      const cat = categorise(key, enLen);
      const keep = WIDE ? shortEn && risky : shortEn && risky && cat !== 'prose';
      if (ALL || keep) {
        rows.push({ ns, key, lng, enVal, val, enLen, len, delta, ratio, cat });
      }
    }
  }
}

rows.sort((a, b) => b.delta - a.delta || b.ratio - a.ratio);

if (rows.length === 0) {
  console.log('No layout-risk candidates found (short en → much longer translation).');
  process.exit(0);
}

console.log(`\n${rows.length} candidate(s) — short English, much longer translation (layout-tight risk):\n`);
for (const r of rows) {
  console.log(
    `[${r.cat}] [${r.lng}] ${r.ns}:${r.key}  (en ${r.enLen} → ${r.len}, +${r.delta}, ×${r.ratio.toFixed(2)})`,
  );
  console.log(`    en: "${r.enVal}"`);
  console.log(`    ${r.lng}: "${r.val}"`);
}
console.log(`\nTip: --ns=<name> focus one namespace · --wide include prose · --all dump every key.\n`);
