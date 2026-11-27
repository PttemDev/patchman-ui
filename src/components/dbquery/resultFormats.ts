import * as XLSX from 'xlsx';
import { DB_KIND_FAMILY, type DBKind } from '@/types';
import { stringifyValue } from './formatters';

// Text formats for copying and downloading result rows. Pure functions so
// the table, the selection bar and the export menu all agree on output.

export type RowObj = Record<string, unknown>;
export type CopyFormat = 'tsv' | 'csv' | 'json' | 'markdown' | 'insert';
export type DownloadFormat = 'csv' | 'json' | 'jsonl' | 'xlsx';

/** Plain text for one cell: NULL stays NULL, objects become JSON. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

/** Quote an identifier the way the connection's dialect expects. */
export function quoteIdent(name: string, kind?: DBKind): string {
  if (kind === 'mongo') return name;
  if (kind === 'sqlserver') return `[${name.replace(/]/g, ']]')}]`;
  if (kind === 'bigquery') return `\`${name.replace(/`/g, '\\`')}\``;
  if (kind && DB_KIND_FAMILY[kind] === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote only when the bare name would not survive (case folding, spaces…). */
export function quoteIdentIfNeeded(name: string, kind?: DBKind): string {
  if (kind === 'mongo') return name;
  const family = kind ? DB_KIND_FAMILY[kind] : 'postgres';
  const plain = family === 'postgres' && kind !== 'sqlserver' && kind !== 'bigquery'
    ? /^[a-z_][a-z0-9_$]*$/.test(name) // Postgres folds unquoted names to lower case
    : /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name);
  return plain ? name : quoteIdent(name, kind);
}

export function sqlLiteral(v: unknown, kind?: DBKind): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') {
    if (kind === 'sqlserver') return v ? '1' : '0';
    return v ? 'TRUE' : 'FALSE';
  }
  const s = typeof v === 'object' ? cellText(v) : String(v);
  const lit = `'${s.replace(/'/g, "''")}'`;
  if (typeof v === 'object' && (!kind || DB_KIND_FAMILY[kind] === 'postgres') && kind !== 'sqlserver' && kind !== 'bigquery') {
    return `${lit}::jsonb`;
  }
  return lit;
}

/** `col = value` / `col IS NULL` for pasting into a WHERE clause. */
export function whereCondition(col: string, v: unknown, kind?: DBKind): string {
  const c = quoteIdentIfNeeded(col, kind);
  return v === null || v === undefined ? `${c} IS NULL` : `${c} = ${sqlLiteral(v, kind)}`;
}

/** `('a', 'b', 3)` — distinct non-null values for an IN (...) list. */
export function inList(values: unknown[], kind?: DBKind): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const lit = sqlLiteral(v, kind);
    if (seen.has(lit)) continue;
    seen.add(lit);
    out.push(lit);
  }
  return `(${out.join(', ')})`;
}

export function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function tsvCell(v: unknown): string {
  // Tabs/newlines inside a value would break the grid when pasted into a
  // spreadsheet, so they become spaces.
  return v === null || v === undefined ? '' : cellText(v).replace(/[\t\r\n]+/g, ' ');
}

function mdCell(v: unknown): string {
  return cellText(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

export function formatRows(
  fmt: CopyFormat,
  cols: string[],
  rows: RowObj[],
  opts: { header?: boolean; kind?: DBKind; table?: string } = {},
): string {
  const header = opts.header ?? true;
  switch (fmt) {
    case 'tsv': {
      const body = rows.map((r) => cols.map((c) => tsvCell(r[c])).join('\t'));
      return (header ? [cols.join('\t'), ...body] : body).join('\n');
    }
    case 'csv': {
      const body = rows.map((r) => cols.map((c) => csvEscape(stringifyValue(r[c]))).join(','));
      return (header ? [cols.map(csvEscape).join(','), ...body] : body).join('\n');
    }
    case 'json': {
      const picked = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      return JSON.stringify(picked.length === 1 ? picked[0] : picked, null, 2);
    }
    case 'markdown': {
      const head = `| ${cols.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
      const sep = `| ${cols.map(() => '---').join(' | ')} |`;
      const body = rows.map((r) => `| ${cols.map((c) => mdCell(r[c])).join(' | ')} |`);
      return [head, sep, ...body].join('\n');
    }
    case 'insert': {
      const table = (opts.table || 'table_name').split('.').map((p) => quoteIdentIfNeeded(p, opts.kind)).join('.');
      const cs = cols.map((c) => quoteIdentIfNeeded(c, opts.kind)).join(', ');
      return rows
        .map((r) => `INSERT INTO ${table} (${cs}) VALUES (${cols.map((c) => sqlLiteral(r[c], opts.kind)).join(', ')});`)
        .join('\n');
    }
  }
}

function normalizeCell(v: unknown): unknown {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return v;
}

export function downloadRows(fmt: DownloadFormat, cols: string[], rows: RowObj[], base = 'result') {
  if (fmt === 'xlsx') {
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(cols.map((c) => [c, normalizeCell(r[c])]))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Result');
    XLSX.writeFile(wb, `${base}.xlsx`);
    return;
  }
  const picked = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  let blob: Blob;
  if (fmt === 'json') {
    blob = new Blob([JSON.stringify(picked, null, 2)], { type: 'application/json' });
  } else if (fmt === 'jsonl') {
    blob = new Blob([picked.map((r) => JSON.stringify(r)).join('\n')], { type: 'application/jsonl' });
  } else {
    blob = new Blob([formatRows('csv', cols, rows)], { type: 'text/csv' });
  }
  triggerDownload(blob, `${base}.${fmt}`);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Best-effort table name from `FROM x` of a single-table SELECT. */
export function guessSourceTable(query: string | undefined): string | undefined {
  if (!query) return undefined;
  const m = /\bfrom\s+((?:[`"[]?[\w$]+[`"\]]?\.)?[`"[]?[\w$]+[`"\]]?)/i.exec(query);
  if (!m) return undefined;
  if (/\bjoin\b/i.test(query)) return undefined;
  return m[1].replace(/[`"[\]]/g, '');
}
