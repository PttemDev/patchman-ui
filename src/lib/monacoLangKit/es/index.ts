import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { useESConnectionStore } from '@/stores/esConnectionStore';
import i18n from '@/i18n';

// ── Kibana console request grammar ──────────────────────────────────────
// The ES console buffer holds one or more requests, each a `METHOD path`
// line optionally followed by a JSON body. Requests are separated by blank
// lines (Kibana Dev Tools convention). These helpers are shared by the
// completion provider (below) and ESConsolePanel (run-under-cursor / run-all
// / validate), so the two always agree on where a request starts and ends.

export interface KibanaRequest {
  method: string;
  /** Path as typed, e.g. "my-index/_search" or "/_cat/indices?v". */
  path: string;
  /** Raw JSON body text (possibly multi-line); '' when the request has none. */
  body: string;
  /** 1-based line of the `METHOD path` line. */
  startLine: number;
  /** 1-based last line the request spans (body end, or the method line). */
  endLine: number;
}

const METHOD_RE = /^\s*(GET|POST|PUT|DELETE|HEAD|PATCH)\s+(\S.*)$/i;

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('#') || t.startsWith('//');
}

// braceDelta returns the net {[ minus }] on a line, ignoring brackets inside
// double-quoted strings, so we can tell when a JSON body has closed.
function braceDelta(line: string): number {
  let depth = 0, inStr = false, esc = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth;
}

/** parseKibanaRequests splits an editor buffer into its individual requests.
 *  The body spans from the METHOD line until its JSON braces balance, so blank
 *  lines *inside* the body (e.g. an empty object written over two lines) are
 *  kept — a blank line only ends the request once the JSON is complete. */
export function parseKibanaRequests(text: string): KibanaRequest[] {
  const lines = text.split('\n');
  const out: KibanaRequest[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || isComment(raw)) { i++; continue; }
    const m = METHOD_RE.exec(raw);
    if (!m) { i++; continue; }
    const method = m[1].toUpperCase();
    const path = m[2].trim();
    const startLine = i + 1;
    let j = i + 1;
    const bodyLines: string[] = [];
    let depth = 0;
    let started = false;
    while (j < lines.length) {
      const bl = lines[j];
      if (METHOD_RE.test(bl)) break;                 // next request begins
      if (isComment(bl)) { j++; continue; }          // comments don't affect depth
      const blank = !bl.trim();
      if (blank && (!started || depth <= 0)) break;  // blank ends a complete/empty body
      bodyLines.push(bl);
      if (!blank) { depth += braceDelta(bl); started = true; }
      j++;
      if (started && depth <= 0) break;              // JSON balanced → body done
    }
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    const endLine = bodyLines.length > 0 ? startLine + bodyLines.length : startLine;
    out.push({ method, path, body: bodyLines.join('\n'), startLine, endLine });
    i = j;
  }
  return out;
}

/** findRequestAtLine returns the request that owns `line` (1-based), or the
 *  nearest preceding request when the cursor sits in the gap after one. */
export function findRequestAtLine(reqs: KibanaRequest[], line: number): KibanaRequest | null {
  let best: KibanaRequest | null = null;
  for (const r of reqs) {
    if (line >= r.startLine && line <= r.endLine) return r;
    if (r.startLine <= line) best = r;
  }
  return best;
}

/** targetIndex pulls the index/alias a request addresses: the first path
 *  segment that isn't an `_action` and isn't empty. Returns '' for cluster-
 *  level calls like `/_cat/indices` or `_search` across everything. */
export function targetIndex(path: string): string {
  const clean = path.replace(/^\//, '').split('?')[0];
  const seg = clean.split('/')[0] ?? '';
  if (!seg || seg.startsWith('_')) return '';
  return seg;
}

// ── Per-model binding ───────────────────────────────────────────────────
// The completion provider is registered once against the 'json' language,
// which every JSON editor in the app shares. To avoid polluting unrelated
// editors we only answer for models the ES console has explicitly bound —
// keyed by model URI → { connId, live index names }.

interface EsModelCtx { connId: string; indices: string[]; }
const esModels = new Map<string, EsModelCtx>();

export function bindEsModel(uri: string, connId: string): void {
  const cur = esModels.get(uri);
  esModels.set(uri, { connId, indices: cur?.indices ?? [] });
}
export function setEsModelIndices(uri: string, indices: string[]): void {
  const cur = esModels.get(uri);
  if (cur) cur.indices = indices;
  else esModels.set(uri, { connId: '', indices });
}
export function unbindEsModel(uri: string): void {
  esModels.delete(uri);
}

// ── Static catalogs ─────────────────────────────────────────────────────
const ENDPOINTS: string[] = [
  '_search', '_count', '_msearch', '_bulk', '_doc', '_update', '_create',
  '_delete_by_query', '_update_by_query', '_reindex',
  '_mapping', '_settings', '_stats', '_field_caps', '_analyze',
  '_validate/query', '_explain', '_refresh', '_flush', '_forcemerge',
  '_cat/indices', '_cat/health', '_cat/nodes', '_cat/aliases', '_cat/shards',
  '_aliases', '_alias', '_cluster/health', '_cluster/state', '_cluster/stats',
  '_nodes', '_tasks', '_sql',
];

const DSL_KEYWORDS: string[] = [
  'query', 'bool', 'must', 'should', 'filter', 'must_not', 'minimum_should_match',
  'match', 'match_all', 'match_none', 'match_phrase', 'multi_match', 'query_string',
  'term', 'terms', 'range', 'exists', 'prefix', 'wildcard', 'regexp', 'fuzzy', 'ids',
  'nested', 'gte', 'lte', 'gt', 'lt', 'boost', 'operator', 'fields', 'field',
  'size', 'from', 'sort', 'order', 'track_total_hits', '_source', 'includes', 'excludes',
  'aggs', 'aggregations', 'terms', 'date_histogram', 'histogram', 'range',
  'avg', 'sum', 'min', 'max', 'stats', 'cardinality', 'value_count', 'percentiles',
  'calendar_interval', 'fixed_interval', 'format', 'highlight', 'collapse', 'search_after',
];

// Query-clause snippets — inserted as Monaco snippets (with tab stops) so a
// whole clause skeleton drops in ready to fill.
const SNIPPETS: { label: string; body: string; detail: string }[] = [
  { label: 'query', detail: 'query wrapper', body: '"query": {\n  $0\n}' },
  { label: 'match', detail: 'full-text match', body: '"match": {\n  "${1:field}": "${2:value}"\n}' },
  { label: 'match_all', detail: 'all documents', body: '"match_all": {}' },
  { label: 'term', detail: 'exact term', body: '"term": {\n  "${1:field}": "${2:value}"\n}' },
  { label: 'terms', detail: 'any of terms', body: '"terms": {\n  "${1:field}": [${2:"a", "b"}]\n}' },
  { label: 'range', detail: 'range', body: '"range": {\n  "${1:field}": {\n    "gte": ${2:0},\n    "lte": ${3:100}\n  }\n}' },
  { label: 'bool', detail: 'boolean combine', body: '"bool": {\n  "must": [\n    $0\n  ]\n}' },
  { label: 'exists', detail: 'field exists', body: '"exists": {\n  "field": "${1:field}"\n}' },
  { label: 'wildcard', detail: 'wildcard', body: '"wildcard": {\n  "${1:field}": "${2:*val*}"\n}' },
  { label: 'match_phrase', detail: 'phrase match', body: '"match_phrase": {\n  "${1:field}": "${2:exact phrase}"\n}' },
  { label: 'aggs: terms', detail: 'terms aggregation', body: '"aggs": {\n  "${1:by_field}": {\n    "terms": { "field": "${2:field}", "size": ${3:10} }\n  }\n}' },
  { label: 'aggs: date_histogram', detail: 'date histogram', body: '"aggs": {\n  "${1:over_time}": {\n    "date_histogram": { "field": "${2:@timestamp}", "calendar_interval": "${3:day}" }\n  }\n}' },
  { label: 'sort', detail: 'sort', body: '"sort": [\n  { "${1:field}": "${2:desc}" }\n]' },
  { label: '_source', detail: 'source filter', body: '"_source": [${1:"field1", "field2"}]' },
];

// Every other DSL keyword also completes to a well-formed `"key": value` with
// the value shape ES expects there (clause arrays, objects, scalars, enums) —
// a bare `must_not` was useless inside a JSON body.
const KEYWORD_BODIES: Record<string, string> = {
  must: '"must": [\n  $0\n]',
  should: '"should": [\n  $0\n]',
  filter: '"filter": [\n  $0\n]',
  must_not: '"must_not": [\n  $0\n]',
  minimum_should_match: '"minimum_should_match": ${1:1}',
  match_none: '"match_none": {}',
  multi_match: '"multi_match": {\n  "query": "${1:text}",\n  "fields": [${2:"field"}]\n}',
  query_string: '"query_string": {\n  "query": "${1:text}"\n}',
  prefix: '"prefix": {\n  "${1:field}": "${2:value}"\n}',
  regexp: '"regexp": {\n  "${1:field}": "${2:pattern}"\n}',
  fuzzy: '"fuzzy": {\n  "${1:field}": "${2:value}"\n}',
  ids: '"ids": {\n  "values": [${1:"id"}]\n}',
  nested: '"nested": {\n  "path": "${1:path}",\n  "query": {\n    $0\n  }\n}',
  gte: '"gte": ${1:0}',
  lte: '"lte": ${1:0}',
  gt: '"gt": ${1:0}',
  lt: '"lt": ${1:0}',
  boost: '"boost": ${1:1.0}',
  operator: '"operator": "${1|and,or|}"',
  fields: '"fields": [${1:"field"}]',
  field: '"field": "${1:field}"',
  size: '"size": ${1:10}',
  from: '"from": ${1:0}',
  order: '"order": "${1|desc,asc|}"',
  track_total_hits: '"track_total_hits": ${1|true,false|}',
  includes: '"includes": [${1:"field"}]',
  excludes: '"excludes": [${1:"field"}]',
  aggs: '"aggs": {\n  "${1:name}": {\n    $0\n  }\n}',
  aggregations: '"aggregations": {\n  "${1:name}": {\n    $0\n  }\n}',
  date_histogram: '"date_histogram": {\n  "field": "${1:@timestamp}",\n  "calendar_interval": "${2|day,week,month,hour,minute|}"\n}',
  histogram: '"histogram": {\n  "field": "${1:field}",\n  "interval": ${2:10}\n}',
  avg: '"avg": {\n  "field": "${1:field}"\n}',
  sum: '"sum": {\n  "field": "${1:field}"\n}',
  min: '"min": {\n  "field": "${1:field}"\n}',
  max: '"max": {\n  "field": "${1:field}"\n}',
  stats: '"stats": {\n  "field": "${1:field}"\n}',
  cardinality: '"cardinality": {\n  "field": "${1:field}"\n}',
  value_count: '"value_count": {\n  "field": "${1:field}"\n}',
  percentiles: '"percentiles": {\n  "field": "${1:field}",\n  "percents": [${2:50, 95, 99}]\n}',
  calendar_interval: '"calendar_interval": "${1|day,week,month,hour,minute|}"',
  fixed_interval: '"fixed_interval": "${1:1h}"',
  format: '"format": "${1:yyyy-MM-dd}"',
  highlight: '"highlight": {\n  "fields": {\n    "${1:field}": {}\n  }\n}',
  collapse: '"collapse": {\n  "field": "${1:field}"\n}',
  search_after: '"search_after": [${1}]',
};

const SNIPPET_LABELS = new Set(SNIPPETS.map((s) => s.label));
// Keywords without a hand-written clause snippet above (deduped — the keyword
// list repeats a few names across query/agg sections).
const KEYWORD_SNIPPETS = Array.from(new Set(DSL_KEYWORDS))
  .filter((kw) => !SNIPPET_LABELS.has(kw))
  .map((kw) => ({ label: kw, body: KEYWORD_BODIES[kw] ?? `"${kw}": $0` }));

// Body positions where an index field name (rather than a DSL keyword) is the
// natural completion — the RHS of `"field":`, or a property key directly under
// term/match/range/exists/prefix/wildcard.
const FIELD_VALUE_RE = /"(?:field|default_field)"\s*:\s*"[^"]*$/;
const FIELD_KEY_PARENT_RE = /"(?:term|terms|match|match_phrase|range|exists|prefix|wildcard|fuzzy)"\s*:\s*\{\s*"[^"]*$/;

// The ES console uses its own language (not 'json') so the `METHOD path` lines
// aren't reported as JSON syntax errors, while the JSON body still colorizes.
export const KIBANA_LANG = 'kibana-es';

// Registers the custom Kibana-console language: a Monarch tokenizer that
// highlights the METHOD + path line and the JSON body, plus bracket/quote
// auto-closing. No language service runs on it, so there are no false errors —
// real query validation is the explicit `_validate/query` "Validate" action.
function registerKibanaLanguage(monaco: Monaco): void {
  if (monaco.languages.getLanguages().some((l: MonacoType.languages.ILanguageExtensionPoint) => l.id === KIBANA_LANG)) return;
  monaco.languages.register({ id: KIBANA_LANG });
  monaco.languages.setLanguageConfiguration(KIBANA_LANG, {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' },
      { open: '(', close: ')' }, { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' },
    ],
  });
  monaco.languages.setMonarchTokensProvider(KIBANA_LANG, {
    ignoreCase: true,
    defaultToken: '',
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\s*\/\/.*$/, 'comment'],
        // METHOD path — the whole line: [indent, method, space, path].
        [/^(\s*)(GET|POST|PUT|DELETE|HEAD|PATCH)(\s+)(.*)$/, ['white', 'keyword', 'white', 'type']],
        // JSON body.
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, 'number'],
        [/[{}[\]]/, '@brackets'],
        [/[:,]/, 'delimiter'],
        [/\s+/, 'white'],
      ],
    },
  } as MonacoType.languages.IMonarchLanguage);
}

let registered = false;

/**
 * registerEsCompletion registers the custom Kibana-console language and one
 * Monaco completion provider for it. The provider only answers for models bound
 * via bindEsModel, reading live index names and the esConnectionStore mapping
 * cache. Offline — never fetches. Idempotent.
 */
export function registerEsCompletion(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  registerKibanaLanguage(monaco);

  monaco.languages.registerCompletionItemProvider(KIBANA_LANG, {
    triggerCharacters: ['"', '/', ' ', '_', '{', ':', ','],
    provideCompletionItems: (model: MonacoType.editor.ITextModel, position: MonacoType.Position) => {
      const ctx = esModels.get(model.uri.toString());
      if (!ctx) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const kind = monaco.languages.CompletionItemKind;
      const out: MonacoType.languages.CompletionItem[] = [];

      const reqs = parseKibanaRequests(model.getValue());
      const req = findRequestAtLine(reqs, position.lineNumber);

      const indexNames = ctx.indices;
      const mappingsByConn = useESConnectionStore.getState().mappings[ctx.connId] ?? {};

      // Path line: endpoint catalog + live index/alias names.
      const onPathLine = req != null && position.lineNumber === req.startLine;
      if (onPathLine) {
        const lineToCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        // Only after the METHOD token (Kibana path line).
        if (/^\s*(GET|POST|PUT|DELETE|HEAD|PATCH)\s+/i.test(lineToCursor)) {
          for (const idx of indexNames) {
            out.push({
              label: idx,
              kind: kind.Class,
              insertText: idx,
              detail: 'index',
              sortText: '0' + idx,
              range,
            });
          }
          for (const ep of ENDPOINTS) {
            out.push({
              label: ep,
              kind: kind.Keyword,
              insertText: ep,
              detail: 'endpoint',
              sortText: '1' + ep,
              range,
            });
          }
        }
        return { suggestions: out };
      }

      // Body: DSL keywords + field paths from the target index mapping.
      const idx = req ? targetIndex(req.path) : '';
      const fields = idx ? (mappingsByConn[idx] ?? []) : [];
      const lineToCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const wantsField = FIELD_VALUE_RE.test(lineToCursor) || FIELD_KEY_PARENT_RE.test(lineToCursor);

      if (wantsField && fields.length) {
        for (const f of fields) {
          out.push({
            label: f.path,
            kind: kind.Field,
            insertText: f.path,
            detail: f.type + (f.aggregatable ? ' · aggregatable' : ''),
            sortText: '0' + f.path,
            range,
          });
        }
        return { suggestions: out };
      }

      // Cursor between an empty `{}` pair (typing `{` auto-closes it): the top,
      // preselected item opens the block onto its own line — so Enter does what
      // it would without the popup instead of inserting the first keyword.
      const fullLine = model.getLineContent(position.lineNumber);
      if (/\{\s*$/.test(lineToCursor) && /^\s*\}/.test(fullLine.slice(position.column - 1))) {
        out.push({
          label: '{ ↵ }',
          kind: kind.Snippet,
          insertText: '\n\t$0\n',
          insertTextRules: 4 as MonacoType.languages.CompletionItemInsertTextRule,
          detail: i18n.t('es:console.expandBraces'),
          sortText: '!',
          preselect: true,
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column,
          },
        });
      }

      // Keys are inserted complete (`"key": …`), so the replace range swallows a
      // quote the user already opened and one auto-closed after the word —
      // otherwise `"must_n` would become `""must_not": […]"`. Filtering then
      // sees the typed quote too, so it's part of filterText.
      const openQuote = fullLine[word.startColumn - 2] === '"';
      const closeQuote = fullLine[word.endColumn - 1] === '"';
      const keyRange: MonacoType.IRange = {
        ...range,
        startColumn: word.startColumn - (openQuote ? 1 : 0),
        endColumn: word.endColumn + (closeQuote ? 1 : 0),
      };
      const keyFilter = (label: string) => (openQuote ? '"' : '') + label;
      const docFor = (body: string) => ({
        value: '```json\n' + body.replace(/\$\{\d+\|([^,|}]*)[^}]*\}/g, '$1').replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{?\d+\}?/g, '') + '\n```',
      });

      // Default body context: query-clause snippets first, then the other DSL
      // keywords (also as complete snippets), then field names as a secondary
      // pool so key positions still surface them.
      for (const s of SNIPPETS) {
        out.push({
          label: s.label,
          kind: kind.Snippet,
          insertText: s.body,
          // InsertAsSnippet (4). Referenced by value, not via the runtime enum
          // object — monaco.languages.CompletionItemInsertTextRules is undefined
          // at runtime in this bundle and crashed the provider.
          insertTextRules: 4 as MonacoType.languages.CompletionItemInsertTextRule,
          detail: s.detail,
          documentation: docFor(s.body),
          filterText: keyFilter(s.label),
          sortText: '0' + s.label,
          range: keyRange,
        });
      }
      for (const k of KEYWORD_SNIPPETS) {
        out.push({
          label: k.label,
          kind: kind.Keyword,
          insertText: k.body,
          insertTextRules: 4 as MonacoType.languages.CompletionItemInsertTextRule,
          detail: 'DSL',
          documentation: docFor(k.body),
          filterText: keyFilter(k.label),
          sortText: '1' + k.label,
          range: keyRange,
        });
      }
      for (const f of fields) {
        out.push({
          label: f.path,
          kind: kind.Field,
          insertText: f.path,
          detail: f.type,
          sortText: '2' + f.path,
          range,
        });
      }
      return { suggestions: out };
    },
  });
}
