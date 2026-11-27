// Pure SQL completion analysis (no Monaco): which tables a statement uses
// and under which aliases, where the caret sits, and what a `x.` / `x.y.`
// qualifier points at. monacoDBCompletion turns the answer into items.
//
// Deliberately tolerant: the statement is usually half-typed, so every
// step is regex-over-sanitised-text rather than a real parser.

import type { DBSchemaTable } from '@/types';

export type SqlCtx =
  | 'table' // after FROM / JOIN / UPDATE / INTO / TABLE
  | 'join-on' // right after `JOIN t x ON`
  | 'column' // WHERE / AND / OR / GROUP BY / ORDER BY / HAVING / SET / ON (later)
  | 'select-list' // between SELECT and FROM
  | 'start'; // empty statement / unknown

export interface TableRef {
  schema?: string;
  name: string;
  alias?: string;
  /** Resolved schema table; undefined for CTEs and unknown names. */
  table?: DBSchemaTable;
}

const KEYWORDS_NOT_ALIAS = new Set([
  'where', 'on', 'using', 'join', 'inner', 'left', 'right', 'full', 'cross', 'outer', 'natural',
  'group', 'order', 'limit', 'offset', 'having', 'union', 'intersect', 'except', 'window',
  'set', 'values', 'returning', 'as', 'lateral', 'fetch', 'for', 'select', 'from', 'with',
]);

/**
 * Blank out strings and comments (same length, so offsets stay valid) so
 * a FROM inside a literal or comment never counts.
 */
export function sanitize(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") { closed = true; break; }
        j++;
      }
      // Keep the quotes (same length) so `= '` still reads as "inside a value".
      out += "'" + text.slice(i + 1, j).replace(/[^\n]/g, ' ') + (closed ? "'" : '');
      i = closed ? j + 1 : j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Strip identifier quoting: "x" / `x` / [x] → x. */
export function unquote(id: string): string {
  const t = id.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) return t.slice(1, -1);
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1);
  return t;
}

const ID = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)';
const QUALIFIED = `(${ID}(?:\\s*\\.\\s*${ID}){0,2})`;

function splitQualified(q: string): { schema?: string; name: string } {
  const parts = q.split(/\s*\.\s*/).map(unquote);
  if (parts.length === 1) return { name: parts[0] };
  // db.schema.table (SQL Server / BigQuery project.dataset.table): keep the last two.
  return { schema: parts[parts.length - 2], name: parts[parts.length - 1] };
}

export function findTable(tables: DBSchemaTable[], schema: string | undefined, name: string): DBSchemaTable | undefined {
  const n = name.toLowerCase();
  const s = schema?.toLowerCase();
  return tables.find((t) => t.name.toLowerCase() === n && (!s || (t.schema ?? '').toLowerCase() === s))
    ?? (s ? undefined : tables.find((t) => t.name.toLowerCase() === n));
}

/** Tables (and CTE names) referenced anywhere in the statement, with aliases. */
export function tableRefs(stmt: string, tables: DBSchemaTable[]): TableRef[] {
  const text = sanitize(stmt);
  const refs: TableRef[] = [];
  const push = (qual: string, alias?: string) => {
    const { schema, name } = splitQualified(qual);
    const a = alias ? unquote(alias) : undefined;
    if (a && KEYWORDS_NOT_ALIAS.has(a.toLowerCase())) return push(qual);
    if (refs.some((r) => r.name === name && r.schema === schema && r.alias === a)) return;
    refs.push({ schema, name, alias: a, table: findTable(tables, schema, name) });
  };

  // FROM a [AS] x, b y  — the list runs until the next clause keyword.
  const fromRe = new RegExp(`\\bfrom\\s+([\\s\\S]*?)(?=\\b(?:where|group|order|limit|offset|having|join|inner|left|right|full|cross|natural|union|intersect|except|on|using|window|returning|fetch|for)\\b|\\)|;|$)`, 'gi');
  for (const m of text.matchAll(fromRe)) {
    for (const part of m[1].split(',')) {
      const pm = new RegExp(`^\\s*${QUALIFIED}(?:\\s+(?:as\\s+)?(${ID}))?\\s*$`, 'i').exec(part);
      if (pm && !pm[1].startsWith('(')) push(pm[1], pm[2]);
    }
  }
  // JOIN t [AS] x / UPDATE t [AS] x / INTO t
  const joinRe = new RegExp(`\\b(?:join|update|into)\\s+${QUALIFIED}(?:\\s+(?:as\\s+)?(${ID}))?`, 'gi');
  for (const m of text.matchAll(joinRe)) push(m[1], m[2]);
  // WITH x AS (…), y AS (…) — CTE names behave like tables without columns.
  const cteRe = new RegExp(`(?:\\bwith\\s+(?:recursive\\s+)?|,\\s*)(${ID})\\s+as\\s*\\(`, 'gi');
  for (const m of text.matchAll(cteRe)) {
    const name = unquote(m[1]);
    if (!refs.some((r) => r.name === name)) refs.push({ name });
  }
  return refs;
}

/** Where the caret is, from the statement text before it. */
export function caretContext(before: string): SqlCtx {
  const t = ' ' + sanitize(before).replace(/\s+/g, ' ').toLowerCase();
  if (/^\s*$/.test(t)) return 'start';
  // Innermost open paren: a sub-select restarts the analysis inside it.
  const lastOpen = t.lastIndexOf('(');
  if (lastOpen >= 0 && !t.slice(lastOpen).includes(')') && /\(\s*select\b/.test(t.slice(lastOpen))) {
    return caretContext(t.slice(lastOpen + 1));
  }
  const marks: Array<[RegExp, SqlCtx]> = [
    [/\b(?:from|join|update|into|table)\s+(?:[\w$."`[\]]+(?:\s+(?:as\s+)?[\w$"`[\]]+)?\s*,\s*)*[\w$."`[\]]*$/, 'table'],
    [/\bjoin\s+[\w$."`[\]]+(?:\s+(?:as\s+)?[\w$"`[\]]+)?\s+on\s+[\w$.]*$/, 'join-on'],
  ];
  for (const [re, ctx] of marks) if (re.test(t)) return ctx;
  const clauses: Array<[string, SqlCtx]> = [
    [' select ', 'select-list'], [' from ', 'column'], [' join ', 'column'], [' where ', 'column'],
    [' on ', 'column'], [' and ', 'column'], [' or ', 'column'], [' group by ', 'column'],
    [' order by ', 'column'], [' having ', 'column'], [' set ', 'column'], [' by ', 'column'],
    [' when ', 'column'], [' then ', 'column'], [' else ', 'column'], [' returning ', 'column'],
  ];
  let best = -1;
  let ctx: SqlCtx = 'start';
  for (const [kw, c] of clauses) {
    const i = t.lastIndexOf(kw);
    if (i > best) { best = i; ctx = c; }
  }
  // `FROM t x |` (after a complete table ref) is a keyword position, which
  // the column list still covers well enough; keep 'column'.
  return ctx;
}

/** `a.` / `a.b.` / `a.b.c` just before the caret (the last part may be partial). */
export function qualifierBefore(linePrefix: string): string[] | null {
  const m = new RegExp(`(${ID}(?:\\.${ID})*)\\.([\\w$]*)$`).exec(linePrefix);
  if (!m) return null;
  return m[1].split('.').map(unquote);
}

export type QualifierTarget =
  | { kind: 'columns'; table: DBSchemaTable; via: string }
  | { kind: 'tables'; schema: string; tables: DBSchemaTable[] }
  | { kind: 'none' };

export function resolveQualifier(parts: string[], refs: TableRef[], tables: DBSchemaTable[]): QualifierTarget {
  if (parts.length === 1) {
    const p = parts[0].toLowerCase();
    const byAlias = refs.find((r) => r.alias?.toLowerCase() === p && r.table);
    if (byAlias?.table) return { kind: 'columns', table: byAlias.table, via: parts[0] };
    const byName = refs.find((r) => !r.alias && r.name.toLowerCase() === p && r.table);
    if (byName?.table) return { kind: 'columns', table: byName.table, via: parts[0] };
    const inSchema = tables.filter((t) => (t.schema ?? '').toLowerCase() === p);
    if (inSchema.length > 0) return { kind: 'tables', schema: parts[0], tables: inSchema };
    const anyTable = findTable(tables, undefined, parts[0]);
    if (anyTable) return { kind: 'columns', table: anyTable, via: parts[0] };
    return { kind: 'none' };
  }
  const t = findTable(tables, parts[parts.length - 2], parts[parts.length - 1]);
  return t ? { kind: 'columns', table: t, via: parts.join('.') } : { kind: 'none' };
}

/** Short alias from a table name: order_items → oi, customers → c. */
export function suggestAlias(name: string, taken: Set<string>): string {
  const words = name.split(/[_\s]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  const base = (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 1)).toLowerCase() || 't';
  let alias = KEYWORDS_NOT_ALIAS.has(base) ? base + '1' : base;
  let n = 2;
  while (taken.has(alias)) alias = base + n++;
  return alias;
}

export interface JoinSuggestion {
  /** e.g. `customers c ON c.id = o.customer_id` */
  text: string;
  target: DBSchemaTable;
}

/**
 * JOIN clauses that follow a foreign key between a table already in the
 * statement and another schema table — in either direction.
 */
export function joinSuggestions(
  refs: TableRef[],
  tables: DBSchemaTable[],
  fmtTable: (t: DBSchemaTable) => string,
  fmtIdent: (s: string) => string,
): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const taken = new Set(refs.map((r) => (r.alias ?? r.name).toLowerCase()));
  const seen = new Set<string>();
  const add = (target: DBSchemaTable, cond: (alias: string) => string) => {
    const alias = suggestAlias(target.name, taken);
    const text = `${fmtTable(target)} ${alias} ON ${cond(alias)}`;
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ text, target });
  };
  for (const r of refs) {
    if (!r.table) continue;
    const left = r.alias ?? fmtIdent(r.name);
    // r → target (r holds the FK column)
    for (const fk of r.table.foreignKeys ?? []) {
      const target = findTable(tables, fk.targetSchema, fk.targetTable);
      if (!target) continue;
      add(target, (a) => `${a}.${fmtIdent(fk.targetColumn)} = ${left}.${fmtIdent(fk.column)}`);
    }
    // other → r (another table's FK points at r)
    for (const t of tables) {
      for (const fk of t.foreignKeys ?? []) {
        if (fk.targetTable.toLowerCase() !== r.table.name.toLowerCase()) continue;
        if (fk.targetSchema && r.table.schema && fk.targetSchema.toLowerCase() !== r.table.schema.toLowerCase()) continue;
        add(t, (a) => `${a}.${fmtIdent(fk.column)} = ${left}.${fmtIdent(fk.targetColumn)}`);
      }
    }
  }
  return out;
}

/** `ON` conditions for the most recently joined table against the others. */
export function onConditions(refs: TableRef[], fmtIdent: (s: string) => string): string[] {
  const last = refs[refs.length - 1];
  if (!last?.table || refs.length < 2) return [];
  const out: string[] = [];
  const la = last.alias ?? fmtIdent(last.name);
  for (const r of refs.slice(0, -1)) {
    if (!r.table) continue;
    const ra = r.alias ?? fmtIdent(r.name);
    for (const fk of last.table.foreignKeys ?? []) {
      if (fk.targetTable.toLowerCase() === r.table.name.toLowerCase()) {
        out.push(`${la}.${fmtIdent(fk.column)} = ${ra}.${fmtIdent(fk.targetColumn)}`);
      }
    }
    for (const fk of r.table.foreignKeys ?? []) {
      if (fk.targetTable.toLowerCase() === last.table.name.toLowerCase()) {
        out.push(`${la}.${fmtIdent(fk.targetColumn)} = ${ra}.${fmtIdent(fk.column)}`);
      }
    }
  }
  return out;
}
