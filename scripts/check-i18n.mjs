#!/usr/bin/env node
// i18n coverage guard: every locale namespace must have the SAME set of keys in
// every supported language (en/tr/es/zh). Catches the common regression —
// adding a string to English but forgetting one of the other languages.
// English (the source/fallback) is the reference. Deterministic, no false
// positives. Used by the pre-commit hook (.githooks/pre-commit) and CI.
//
// Run: node scripts/check-i18n.mjs   (or: npm run check:i18n)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const LANGS = ['en', 'tr', 'es', 'zh'];
const REF = 'en';

const errors = [];

function flatten(obj, prefix = '') {
  const out = [];
  for (const k of Object.keys(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, key));
    else out.push(key);
  }
  return out;
}

function load(lng, file) {
  try {
    return JSON.parse(readFileSync(join(LOCALES, lng, file), 'utf8'));
  } catch (e) {
    errors.push(`[${file}] ${lng}: cannot parse (${e.message})`);
    return null;
  }
}

if (!existsSync(join(LOCALES, REF))) {
  console.error(`i18n check: reference locale folder missing: ${join(LOCALES, REF)}`);
  process.exit(1);
}

const nsFiles = readdirSync(join(LOCALES, REF)).filter((f) => f.endsWith('.json'));

for (const file of nsFiles) {
  const ref = load(REF, file);
  if (!ref) continue;
  const refKeys = new Set(flatten(ref));
  for (const lng of LANGS) {
    if (lng === REF) continue;
    const path = join(LOCALES, lng, file);
    if (!existsSync(path)) {
      errors.push(`[${file}] missing translation file: ${lng}/${file}`);
      continue;
    }
    const data = load(lng, file);
    if (!data) continue;
    const keys = new Set(flatten(data));
    for (const k of refKeys) if (!keys.has(k)) errors.push(`[${file}] ${lng} is MISSING key: ${k}`);
    for (const k of keys) if (!refKeys.has(k)) errors.push(`[${file}] ${lng} has EXTRA key (not in ${REF}): ${k}`);
  }
}

// A namespace present in another language but not in English (the reference).
for (const lng of LANGS) {
  if (lng === REF) continue;
  const dir = join(LOCALES, lng);
  if (!existsSync(dir)) {
    errors.push(`missing language folder: ${lng}`);
    continue;
  }
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    if (!existsSync(join(LOCALES, REF, file))) {
      errors.push(`[${file}] exists in ${lng} but not in ${REF} (English is the source of truth)`);
    }
  }
}

if (errors.length) {
  console.error(`\n✗ i18n check FAILED — ${errors.length} issue(s):\n`);
  for (const e of errors) console.error('  • ' + e);
  console.error(
    '\nEvery locale namespace must have identical keys in en/tr/es/zh.\n' +
      'Add the missing translations, then re-run: npm run check:i18n\n',
  );
  process.exit(1);
}

console.log('✓ i18n check OK — en/tr/es/zh key sets are in sync across all namespaces.');
