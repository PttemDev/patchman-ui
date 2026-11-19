// Mongo query bar <-> shell text (MONGO_COMPASS_PLAN §C). The bar always
// runs as real shell text through the normal execute path, so the editor and
// the bar show the same query.

export interface MongoBarState {
  filter: string;
  project: string;
  sort: string;
  collation: string;
  /** index name, or '' for the planner's choice */
  hint: string;
  skip: string;
  limit: string;
  /** builder = condition rows compile into `filter`; json = typed by hand. */
  filterMode?: 'builder' | 'json';
  conds?: Cond[];
}

export interface MongoTargetRef { db?: string; coll: string }

export const EMPTY_BAR: MongoBarState = { filter: '', project: '', sort: '', collation: '', hint: '', skip: '', limit: '20' };

const IDENT = /^[A-Za-z_]\w*$/;

export function collPrefix(t: MongoTargetRef): string {
  const coll = IDENT.test(t.coll) ? `.${t.coll}` : `.getCollection('${t.coll.replace(/'/g, "\\'")}')`;
  return t.db ? `db.getSiblingDB('${t.db.replace(/'/g, "\\'")}')${coll}` : `db${coll}`;
}

export function buildFind(t: MongoTargetRef, b: MongoBarState, explain = false): string {
  const filter = b.filter.trim() || '{}';
  let q = `${collPrefix(t)}.find(${filter}${b.project.trim() ? `, ${b.project.trim()}` : ''})`;
  if (b.sort.trim()) q += `.sort(${b.sort.trim()})`;
  if (b.collation.trim()) q += `.collation(${b.collation.trim()})`;
  if (b.hint.trim()) q += `.hint('${b.hint.trim().replace(/'/g, "\\'")}')`;
  if (/^\d+$/.test(b.skip.trim()) && b.skip.trim() !== '0') q += `.skip(${b.skip.trim()})`;
  if (/^\d+$/.test(b.limit.trim()) && b.limit.trim() !== '0') q += `.limit(${b.limit.trim()})`;
  if (explain) q += '.explain()';
  return q;
}

/** Balanced brackets / quotes — a cheap "looks like a document" check. */
export function balanced(s: string): boolean {
  const stack: string[] = [];
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') stack.push(c);
    else if (c === '}' || c === ']' || c === ')') {
      const o = stack.pop();
      if ((c === '}' && o !== '{') || (c === ']' && o !== '[') || (c === ')' && o !== '(')) return false;
    }
  }
  return !quote && stack.length === 0;
}

// Reads `(...)` starting at s[i] === '('; returns the inner text and the
// index after the closing paren.
function readParens(s: string, i: number): { inner: string; end: number } | null {
  if (s[i] !== '(') return null;
  let depth = 0;
  let quote = '';
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === '\\') { j++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return { inner: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  const last = s.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/**
 * Parses a plain find query back into the bar. null when the text is not a
 * find the bar can represent (aggregate, count, explain, other chains…).
 */
export function parseFind(q: string): { target: MongoTargetRef; bar: MongoBarState } | null {
  const s = q.trim();
  const m = s.match(/^db(?:\.getSiblingDB\(\s*(['"])([^'"]+)\1\s*\))?(?:\.getCollection\(\s*(['"])([^'"]+)\3\s*\)|\.([\w-]+))\.find\s*/);
  if (!m) return null;
  const target: MongoTargetRef = { db: m[2], coll: m[4] ?? m[5] };
  let i = m[0].length;
  const args = readParens(s, i);
  if (!args) return null;
  const parts = splitTopLevel(args.inner);
  if (parts.length > 2) return null;
  const bar: MongoBarState = { ...EMPTY_BAR, limit: '', filter: parts[0] && parts[0] !== '{}' ? parts[0] : '', project: parts[1] ?? '' };
  i = args.end;
  while (i < s.length) {
    const rest = s.slice(i);
    const cm = rest.match(/^\s*\.\s*([A-Za-z]+)\s*/);
    if (!cm) return rest.trim() === '' || rest.trim() === ';' ? { target, bar } : null;
    const call = readParens(s, i + cm[0].length);
    if (!call) return null;
    const arg = call.inner.trim();
    switch (cm[1]) {
      case 'sort': bar.sort = arg; break;
      case 'project': case 'projection': bar.project = arg; break;
      case 'collation': bar.collation = arg; break;
      case 'hint': if (/^['"]/.test(arg)) bar.hint = unquote(arg); else return null; break;
      case 'skip': bar.skip = arg; break;
      case 'limit': bar.limit = arg; break;
      case 'toArray': case 'pretty': break;
      default: return null;
    }
    i = call.end;
  }
  return { target, bar };
}

// ── Filter builder ──────────────────────────────────────────────────────────
// Rows of field / operator / value compiled to a filter document (AND).
// Values follow the field's sampled type: numbers stay numbers, dates become
// {$date}, 24-hex ids {$oid}.

export type CondOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'exists' | 'notExists' | 'isNull';
export interface Cond { field: string; op: CondOp; value: string }

export const COND_OPS: CondOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'exists', 'notExists', 'isNull'];
export const VALUELESS: CondOp[] = ['exists', 'notExists', 'isNull'];

const KEY_IDENT = /^[A-Za-z_$][\w$]*$/;
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const keyOf = (f: string) => (KEY_IDENT.test(f) ? f : quote(f));
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function literal(raw: string, type?: string): string {
  const v = raw.trim();
  const t = (type ?? '').toLowerCase();
  if (v === 'null') return 'null';
  if (t === 'bool' || t === 'boolean') return /^(true|1|yes)$/i.test(v) ? 'true' : 'false';
  if (/^(int|long|double|decimal|number)/.test(t) && v !== '' && !Number.isNaN(Number(v))) return String(Number(v));
  if (/date/.test(t) && !Number.isNaN(Date.parse(v))) return `{ $date: ${quote(new Date(v).toISOString())} }`;
  if (/objectid/.test(t) || /^[0-9a-f]{24}$/i.test(v)) return `{ $oid: ${quote(v)} }`;
  // Unknown or mixed types: go by what the value looks like, unless the
  // field is known to hold strings.
  if (t !== 'string') {
    if (/^-?\d+(\.\d+)?$/.test(v)) return v;
    if (/^(true|false)$/.test(v)) return v;
    if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(v) && !Number.isNaN(Date.parse(v))) return `{ $date: ${quote(new Date(v).toISOString())} }`;
  }
  return quote(v);
}

export function compileConds(conds: Cond[], types: Record<string, string>): string {
  const byField = new Map<string, string[]>();
  for (const c of conds) {
    const f = c.field.trim();
    if (!f) continue;
    const ty = types[f];
    const list = c.value.split(',').map((x) => literal(x, ty)).join(', ');
    let part: string;
    switch (c.op) {
      case 'eq': part = `$eq: ${literal(c.value, ty)}`; break;
      case 'ne': part = `$ne: ${literal(c.value, ty)}`; break;
      case 'gt': case 'gte': case 'lt': case 'lte': part = `$${c.op}: ${literal(c.value, ty)}`; break;
      case 'in': part = `$in: [${list}]`; break;
      case 'nin': part = `$nin: [${list}]`; break;
      case 'contains': part = `$regex: ${quote(reEscape(c.value.trim()))}, $options: 'i'`; break;
      case 'startsWith': part = `$regex: ${quote(`^${reEscape(c.value.trim())}`)}`; break;
      case 'exists': part = '$exists: true'; break;
      case 'notExists': part = '$exists: false'; break;
      case 'isNull': part = '$eq: null'; break;
    }
    byField.set(f, [...(byField.get(f) ?? []), part]);
  }
  if (byField.size === 0) return '';
  const fields = [...byField.entries()].map(([f, parts]) => {
    // A lone equality reads best as { field: value }.
    if (parts.length === 1 && parts[0].startsWith('$eq: ')) return `${keyOf(f)}: ${parts[0].slice(5)}`;
    return `${keyOf(f)}: { ${parts.join(', ')} }`;
  });
  return `{ ${fields.join(', ')} }`;
}

// ── Aggregation pipeline builder (MONGO_COMPASS_PLAN §B) ────────────────────

export interface PipelineStage {
  op: string;
  /** the operator's value, e.g. `{ status: 'paid' }` for $match */
  body: string;
  enabled: boolean;
  collapsed?: boolean;
}

export const STAGE_TEMPLATES: Record<string, string> = {
  $match: '{ }',
  $project: '{ _id: 0, field: 1 }',
  $addFields: '{ newField: "$field" }',
  $set: '{ field: "value" }',
  $unset: '"field"',
  $group: '{ _id: "$field", count: { $sum: 1 } }',
  $sort: '{ field: -1 }',
  $limit: '10',
  $skip: '0',
  $count: '"count"',
  $unwind: '"$arrayField"',
  $lookup: '{ from: "other", localField: "field", foreignField: "_id", as: "joined" }',
  $sortByCount: '"$field"',
  $bucket: '{ groupBy: "$field", boundaries: [0, 100, 1000], default: "other" }',
  $facet: '{ byStatus: [{ $sortByCount: "$status" }] }',
  $sample: '{ size: 5 }',
  $replaceRoot: '{ newRoot: "$field" }',
  $out: '"collection"',
  $merge: '{ into: "collection" }',
};
export const STAGE_OPS = Object.keys(STAGE_TEMPLATES);
export const WRITE_STAGES = ['$out', '$merge'];

export const stageText = (s: PipelineStage) => `{ ${s.op}: ${s.body.trim() || '{}'} }`;

export function buildAggregate(t: MongoTargetRef, stages: PipelineStage[], explain = false): string {
  const on = stages.filter((s) => s.enabled);
  const body = on.length ? `[\n  ${on.map(stageText).join(',\n  ')}\n]` : '[]';
  return `${collPrefix(t)}.aggregate(${body})${explain ? '.explain()' : ''}`;
}

/** Parses `….aggregate([ {…}, … ])` back into stages; null if it can't. */
export function parseAggregate(q: string): { target: MongoTargetRef; stages: PipelineStage[] } | null {
  const s = q.trim();
  const m = s.match(/^db(?:\.getSiblingDB\(\s*(['"])([^'"]+)\1\s*\))?(?:\.getCollection\(\s*(['"])([^'"]+)\3\s*\)|\.([\w-]+))\.aggregate\s*/);
  if (!m) return null;
  const args = readParens(s, m[0].length);
  if (!args || s.slice(args.end).trim().replace(/;$/, '') !== '') return null;
  const inner = args.inner.trim();
  if (!inner.startsWith('[') || !inner.endsWith(']')) return null;
  const stages: PipelineStage[] = [];
  for (const part of splitTopLevel(inner.slice(1, -1))) {
    const sm = part.match(/^\{\s*['"]?(\$\w+)['"]?\s*:\s*([\s\S]*)\}$/);
    if (!sm) return null;
    stages.push({ op: sm[1], body: sm[2].trim(), enabled: true });
  }
  return { target: { db: m[2], coll: m[4] ?? m[5] }, stages };
}
