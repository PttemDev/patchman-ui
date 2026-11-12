import { format as sqlFormat } from 'sql-formatter';
import type { DBKind } from '@/types';
import { DB_KIND_FAMILY } from '@/types';

// formatQuery returns a beautified version of `text` for the given
// connection kind. SQL drivers go through sql-formatter; Mongo gets a
// custom path because the shell dialect isn't strict JSON. Falls back
// to the input on parse failure so the user never loses their query.
export function formatQuery(text: string, kind: DBKind | undefined): string {
  if (!text.trim()) return text;
  if (!kind) return text;
  try {
    if (DB_KIND_FAMILY[kind] === 'mongo') {
      return formatMongoShell(text);
    }
    return sqlFormat(text, sqlOptionsFor(kind));
  } catch {
    return text;
  }
}

function sqlOptionsFor(kind: DBKind) {
  const family = DB_KIND_FAMILY[kind];
  // sql-formatter ships per-dialect grammars — map our kinds to the
  // closest match. CockroachDB / Yugabyte / Redshift parse cleanly as
  // postgresql; TiDB + MariaDB parse as mysql.
  const language: 'postgresql' | 'mysql' | 'sql' =
    family === 'postgres' ? 'postgresql'
    : family === 'mysql' ? 'mysql'
    : 'sql';
  return {
    language,
    keywordCase: 'upper' as const,
    dataTypeCase: 'upper' as const,
    functionCase: 'upper' as const,
    identifierCase: 'preserve' as const,
    indentStyle: 'standard' as const,
    logicalOperatorNewline: 'before' as const,
    tabWidth: 2,
    useTabs: false,
    linesBetweenQueries: 2,
  };
}

// formatMongoShell pretty-prints a `db.<coll>.<op>(<args>)…` call.
// Strategy: locate the outer `(…)` of each call, parse the arg(s) as
// shell-flavoured JSON, JSON.stringify(..., 2), then rebuild the string
// with chained `.method(...)` calls each on their own line.
export function formatMongoShell(text: string): string {
  const s = text.trim();
  // Walk and split on the first `db.…(…)` block + any chained
  // `.method(...)` calls. If anything looks off, return the input.
  const head = findDbHead(s);
  if (!head) return text;
  const { headEnd } = head;
  // Now parse the first call's argument body.
  const open = s.indexOf('(', headEnd);
  if (open < 0) return text;
  const arg = captureBalanced(s, open + 1);
  if (!arg) return text;
  const prettyArg = prettifyShellJSON(arg.body);
  let out = `${s.slice(0, open + 1)}${prettyArg}${prettyArg ? '\n' : ''})`;

  // Chained calls: `.method(arg)…`
  let rest = arg.after.trim();
  while (rest) {
    if (!rest.startsWith('.')) break;
    rest = rest.slice(1);
    const pi = rest.indexOf('(');
    if (pi < 0) break;
    const method = rest.slice(0, pi).trim();
    const cap = captureBalanced(rest, pi + 1);
    if (!cap) break;
    const chainArg = prettifyShellJSON(cap.body, /* inline */ cap.body.length < 40);
    if (chainArg.includes('\n')) {
      out += `\n  .${method}(${chainArg}\n  )`;
    } else {
      out += `\n  .${method}(${chainArg})`;
    }
    rest = cap.after.trim();
  }
  if (rest) out += rest;
  return out;
}

interface DbHeadMatch { headEnd: number }

// findDbHead finds the end-index (exclusive) of the `db.<coll>` prefix
// or `db.getSiblingDB(...).<coll>` prefix, just before the `.<op>(`.
function findDbHead(s: string): DbHeadMatch | null {
  if (!s.startsWith('db.')) return null;
  let i = 3;
  // Optional getSiblingDB('…').
  if (s.slice(i).startsWith('getSiblingDB')) {
    const open = s.indexOf('(', i);
    if (open < 0) return null;
    const cap = captureBalanced(s, open + 1);
    if (!cap) return null;
    i = open + 1 + cap.body.length + 1;
    if (s[i] !== '.') return null;
    i += 1;
  }
  // Optional getCollection('…')
  if (s.slice(i).startsWith('getCollection')) {
    const open = s.indexOf('(', i);
    if (open < 0) return null;
    const cap = captureBalanced(s, open + 1);
    if (!cap) return null;
    i = open + 1 + cap.body.length + 1;
    // Next char should be `.<op>(`
    return { headEnd: i };
  }
  // Bare `db.coll.op(`
  const dotIdx = s.indexOf('.', i);
  if (dotIdx < 0) return null;
  return { headEnd: dotIdx };
}

interface Captured { body: string; after: string }
function captureBalanced(s: string, start: number): Captured | null {
  let depth = 1;
  let inSingle = false, inDouble = false, prev = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '\'' && !inDouble && prev !== '\\') inSingle = !inSingle;
    else if (c === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && (c === '(' || c === '{' || c === '[')) depth++;
    else if (!inSingle && !inDouble && (c === ')' || c === '}' || c === ']')) {
      depth--;
      if (depth === 0) return { body: s.slice(start, i), after: s.slice(i + 1) };
    }
    prev = c;
  }
  return null;
}

// prettifyShellJSON attempts to parse `body` as JS-flavoured JSON (the
// Mongo shell admits unquoted keys + single quotes) and reformats it.
// Multiple comma-separated top-level args are pretty-printed too.
function prettifyShellJSON(body: string, forceInline = false): string {
  const t = body.trim();
  if (!t) return '';
  const args = splitTopLevelArgs(t);
  const formatted = args.map((a) => {
    const norm = normalizeShellJSON(a.trim());
    try {
      const parsed = JSON.parse(norm);
      return JSON.stringify(parsed, null, forceInline ? 0 : 2);
    } catch {
      return a.trim();
    }
  });
  if (forceInline) return formatted.join(', ');
  // Multi-arg: each on its own indented line.
  const indented = formatted.map((line) => line.split('\n').map((l, i) => (i === 0 ? '  ' : '  ') + l).join('\n'));
  return '\n' + indented.join(',\n') + '\n';
}

function normalizeShellJSON(s: string): string {
  // {foo: 1} → {"foo": 1}
  s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
  // 'string' → "string"
  s = s.replace(/'((?:\\'|[^'])*)'/g, (m) => {
    const inner = m.slice(1, -1).replace(/"/g, '\\"').replace(/\\'/g, "'");
    return `"${inner}"`;
  });
  return s;
}

function splitTopLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, inSingle = false, inDouble = false, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\'' && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
      else if (c === ',' && depth === 0) {
        out.push(s.slice(last, i));
        last = i + 1;
      }
    }
  }
  out.push(s.slice(last));
  return out;
}
