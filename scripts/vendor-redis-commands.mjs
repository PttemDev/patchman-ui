// vendor-redis-commands.mjs — fetch the canonical redis-doc command corpus
// and prune it into the Monaco lang-kit asset the FE ships.
//
//   node scripts/vendor-redis-commands.mjs
//
// Source of truth: https://raw.githubusercontent.com/redis/redis-doc/master/commands.json
// Each entry is pruned to {summary, arity, group, complexity, since, arguments}
// (drop acl_categories, command_flags, hints, key_specs, doc_flags, replaced_by,
// deprecated_since, container, history …) to keep the bundled asset small — it
// only feeds completion / hover / signature-help / arity markers.
//
// Output: fe/src/lib/monacoLangKit/redis/commands.json
//
// If the network is unreachable the script exits non-zero WITHOUT touching the
// committed asset, so a curated fallback corpus (already in the repo) stays in
// place. See redis-impl-spec §FE completion.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://raw.githubusercontent.com/redis/redis-doc/master/commands.json';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/monacoLangKit/redis/commands.json',
);

// Keep only the argument fields the FE actually renders in signature help.
function pruneArg(arg) {
  const out = { name: arg.name, type: arg.type };
  if (arg.token) out.token = arg.token;
  if (arg.optional) out.optional = true;
  if (arg.multiple) out.multiple = true;
  if (Array.isArray(arg.arguments)) out.arguments = arg.arguments.map(pruneArg);
  return out;
}

function pruneEntry(e) {
  const out = {
    summary: e.summary ?? '',
    arity: typeof e.arity === 'number' ? e.arity : 0,
    group: e.group ?? 'generic',
  };
  if (e.complexity) out.complexity = e.complexity;
  if (e.since) out.since = e.since;
  if (Array.isArray(e.arguments) && e.arguments.length) {
    out.arguments = e.arguments.map(pruneArg);
  }
  return out;
}

async function main() {
  process.stderr.write(`Fetching ${SRC} …\n`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();

  const pruned = {};
  for (const [name, entry] of Object.entries(raw)) {
    pruned[name] = pruneEntry(entry);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(pruned, null, 0) + '\n', 'utf8');
  process.stderr.write(`Wrote ${Object.keys(pruned).length} commands → ${OUT}\n`);
}

main().catch((err) => {
  process.stderr.write(`vendor-redis-commands failed: ${err.message}\n`);
  process.stderr.write('Leaving the committed corpus untouched.\n');
  process.exit(1);
});
