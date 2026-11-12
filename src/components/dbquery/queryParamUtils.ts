// Detects {{var}} placeholders in a query string and substitutes them
// with the provided values. Single brace ({var}) is ignored to stay
// compatible with bind-variable syntaxes that some DBs use.

const RE = /\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g;

export function extractQueryParams(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(text)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

export function substituteQueryParams(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(RE, (_full, name: string) => {
    const v = values[name];
    return v == null ? '' : v;
  });
}

// SqlFamily mirrors DB_KIND_FAMILY's value type. Kept local so this SQL
// utility module stays dependency-light; callers pass DB_KIND_FAMILY[kind].
export type SqlFamily = 'postgres' | 'mysql' | 'mongo';

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

// Reserved words that must be quoted even when they otherwise look like a
// plain identifier (a column literally named `order`, `user`, `set`, ...).
// Compact on purpose — just the ones that realistically collide with
// column names in a SELECT.
const RESERVED = new Set([
  'select', 'from', 'where', 'order', 'group', 'by', 'having', 'limit',
  'offset', 'join', 'inner', 'outer', 'left', 'right', 'full', 'on', 'as',
  'and', 'or', 'not', 'null', 'insert', 'update', 'delete', 'set', 'into',
  'values', 'table', 'user', 'primary', 'key', 'index', 'default', 'case',
  'when', 'then', 'else', 'end', 'like', 'in', 'is', 'between', 'distinct',
  'union', 'all', 'create', 'drop', 'alter', 'grant', 'revoke', 'desc',
  'asc', 'column', 'comment', 'lock', 'merge', 'copy', 'analyze', 'vacuum',
  'rename', 'truncate', 'to', 'using', 'natural', 'cross', 'exists',
]);

// quoteIdent quotes a SQL identifier ONLY when necessary, using the quote
// char for the dialect (backticks for MySQL family, double quotes for
// Postgres family). A plain lowercase identifier is left unquoted so:
//   • Postgres case-folding still matches the stored column (no forced
//     case-sensitive lookup that misses a lower-cased column), and
//   • MySQL doesn't misread a double-quoted name as a string literal.
// This is the "loosening" — we stop blindly double-quoting every column.
export function quoteIdent(name: string, family: SqlFamily): string {
  if (family === 'mongo') return name;
  const needsQuote = !SAFE_IDENT.test(name) || RESERVED.has(name);
  if (!needsQuote) return name;
  if (family === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  return '"' + name.replace(/"/g, '""') + '"';
}

// quoteQualified quotes an optionally schema-qualified identifier. On the
// Postgres family the default `public` schema is dropped (search-path).
export function quoteQualified(
  schema: string | undefined,
  name: string,
  family: SqlFamily,
): string {
  if (family === 'mongo') return name;
  const qName = quoteIdent(name, family);
  const dropPublic = family !== 'mysql' && schema === 'public';
  if (schema && !dropPublic) return `${quoteIdent(schema, family)}.${qName}`;
  return qName;
}

// pushFilterClause builds a WHERE clause and inserts it into the query
// before ORDER BY / GROUP BY / LIMIT. If a WHERE already exists it
// appends with AND. Returns the new query string. `family` selects the
// dialect for identifier quoting + literal casting.
export function pushFilterClause(
  query: string,
  col: string,
  op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL',
  value: unknown,
  family: SqlFamily = 'postgres',
): string {
  const literal = op === 'IS NULL' || op === 'IS NOT NULL'
    ? ''
    : ` ${sqlLiteral(value, family)}`;
  const clause = `${quoteIdent(col, family)} ${op}${literal}`;

  // Find the first ORDER BY / GROUP BY / LIMIT / HAVING / ; outside
  // of quotes — we splice the new clause in front of it (or before
  // the trailing semi, or at end).
  const upper = query.toUpperCase();
  const stopKw = [' ORDER BY ', ' GROUP BY ', ' LIMIT ', ' OFFSET ', ' HAVING '];
  let cut = query.length;
  for (const kw of stopKw) {
    const i = upper.indexOf(kw);
    if (i >= 0 && i < cut) cut = i;
  }
  // Trim trailing semicolons / whitespace inside the splice zone.
  let head = query.slice(0, cut).trimEnd();
  const tail = query.slice(cut);
  const trailingSemi = head.endsWith(';');
  if (trailingSemi) head = head.slice(0, -1).trimEnd();

  const hasWhere = /\bWHERE\b/i.test(head);
  const sep = hasWhere ? ' AND ' : ' WHERE ';
  return `${head}${sep}${clause}${trailingSemi ? ';' : ''}${tail.startsWith(' ') ? tail : (tail ? ' ' + tail : '')}`.trimEnd();
}

function sqlLiteral(v: unknown, family: SqlFamily = 'postgres'): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    const json = `'${JSON.stringify(v).replace(/'/g, "''")}'`;
    // Only Postgres has a jsonb type/cast; MySQL compares JSON as a string.
    return family === 'mysql' ? json : `${json}::jsonb`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}
