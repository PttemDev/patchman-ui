import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import i18n from '@/i18n';
import { useDBConnectionStore } from '@/stores/dbConnectionStore';
import type { DBKind, DBSchemaTable } from '@/types';
import { splitStatements } from './sqlStatements';
import {
  caretContext,
  joinSuggestions,
  onConditions,
  qualifierBefore,
  resolveQualifier,
  sanitize,
  tableRefs,
} from './sqlCompletion';
import { quoteIdentIfNeeded } from './resultFormats';

// Monaco completion providers are global per language, so there is ONE
// provider per language and each DB editor's model is bound to its
// connection. Two tabs on different connections never see each other's
// tables, and an unbound SQL/JS editor gets no DB suggestions at all.
const providers = new Map<string, MonacoType.IDisposable>();
const bindings = new Map<string, { connectionId: string; kind: DBKind }>();

const MONGO_OPS = [
  'find', 'findOne', 'aggregate', 'count', 'countDocuments',
  'estimatedDocumentCount', 'distinct', 'explain',
];

// Chain methods that follow a find() cursor. Surfaced after `.find().`
// or any cursor-returning op.
const MONGO_CURSOR_METHODS = [
  'limit', 'skip', 'sort', 'project', 'projection', 'count', 'toArray', 'pretty',
];

const MONGO_STAGES = [
  '$match', '$group', '$project', '$lookup', '$unwind', '$sort',
  '$limit', '$skip', '$addFields', '$set', '$replaceRoot', '$count',
  '$facet', '$bucket', '$bucketAuto', '$sortByCount', '$out', '$merge',
];

const MONGO_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$and', '$or', '$not', '$nor', '$exists', '$regex', '$type',
  '$size', '$all', '$elemMatch', '$mod', '$where', '$expr',
];

// Shell helpers that take a quoted name and return a DB or collection.
// Suggested inside `db.getSiblingDB(` / `db.getCollection(` parens.
const MONGO_SHELL_HELPERS = ['getSiblingDB', 'getCollection'];

/**
 * bindDBCompletion points an editor model at a connection; call it again
 * when the tab switches connection. Schemas are read from the store on
 * every request, so a schema refresh shows up without re-binding.
 */
export function bindDBCompletion(monaco: Monaco, model: MonacoType.editor.ITextModel | null, connectionId: string, kind: DBKind) {
  if (!model) return;
  const lang = kind === 'mongo' ? 'mongosh' : 'sql';
  if (kind === 'mongo') {
    ensureMongoshLanguage(monaco);
    if (model.getLanguageId() !== 'mongosh') monaco.editor.setModelLanguage(model, 'mongosh');
  }
  ensureProvider(monaco, lang);
  const uri = model.uri.toString();
  if (!bindings.has(uri)) model.onWillDispose(() => bindings.delete(uri));
  bindings.set(uri, { connectionId, kind });
}

// Mongo editors use 'mongosh': JavaScript colouring without the TypeScript
// worker's diagnostics, which flag shell syntax such as `use merchant` (the
// backend runs it) as errors.
let mongoshRegistered = false;
function ensureMongoshLanguage(monaco: Monaco) {
  if (mongoshRegistered) return;
  mongoshRegistered = true;
  monaco.languages.register({ id: 'mongosh' });
  // @ts-expect-error -- monaco ships this module without type declarations
  void import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js').then((m: { language: unknown; conf: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco.languages.setMonarchTokensProvider('mongosh', m.language as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco.languages.setLanguageConfiguration('mongosh', m.conf as any);
  }).catch(() => { /* plain text colouring */ });
}

function ensureProvider(monaco: Monaco, lang: string) {
  if (providers.has(lang)) return;
  const disposable = monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.', ' ', '('],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems: (model: any, position: any) => {
      // Only editors bound to a DB connection get DB suggestions — other
      // SQL/JS editors (request scripts, notes) are left alone.
      const binding = bindings.get(model.uri.toString());
      if (!binding) return { suggestions: [] };
      const { connectionId, kind } = binding;
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const schemas = useDBConnectionStore.getState().schemas;
      const schema = schemas[connectionId];


      // Use a more permissive type — Monaco's types are exported from
      // the editor package which we don't import directly here.
      const out: {
        label: string;
        kind: number;
        insertText: string;
        detail?: string;
        sortText?: string;
        range: typeof range;
      }[] = [];

      if (kind === 'mongo') {
        const fullText: string = model.getValue();
        const offset: number = model.getOffsetAt(position);
        const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const textToCursor = fullText.slice(0, offset);

        // Distinct DB names found in the schema. Empty when the
        // connection is bound to a single default DB and the introspect
        // pass folded everything under one (blank) schema slot.
        const dbs = new Set<string>();
        schema?.tables.forEach((t) => { if (t.schema) dbs.add(t.schema); });
        const dbList = Array.from(dbs).sort();
        const isMultiDB = dbList.length > 1;

        const collectionsIn = (db?: string) =>
          (schema?.tables ?? []).filter((t) => !db || t.schema === db);

        // Track what we're completing. Higher specificity wins.
        let handled = false;

        // 1) `db.getSiblingDB('name').<coll>.$` → ops
        // 2) `db.getSiblingDB('name').$`         → collections in name
        // 3) `db.<dbname>.<coll>.$`              → ops
        // 4) `db.<dbname>.$`                     → collections in dbname (multi-DB)
        // 5) `db.<coll>.$`                       → ops (default DB)
        // 6) `db.$`                              → DB names + collections in default DB
        // Order below mirrors that priority — the first match wins.

        const siblingCollMatch = /db\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\)\.[a-zA-Z0-9_-]+\.$/.exec(linePrefix);
        if (siblingCollMatch) {
          MONGO_OPS.forEach((op) => out.push({
            label: op,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: op + '($1)',
            detail: 'mongo op',
            sortText: '0' + op,
            range,
          }));
          handled = true;
        }

        if (!handled) {
          const siblingMatch = /db\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\)\.$/.exec(linePrefix);
          if (siblingMatch) {
            collectionsIn(siblingMatch[1]).forEach((t) => out.push({
              label: t.name,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: t.name,
              detail: `${siblingMatch[1]}.${t.name}`,
              sortText: '0' + t.name,
              range,
            }));
            handled = true;
          }
        }

        if (!handled) {
          // db.<a>.<b>.$ — `a` is a DB name (multi-DB only), `b` is collection
          const threeDot = /^|.*[\s(=,]?db\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.$/.exec(linePrefix);
          if (threeDot && isMultiDB && dbs.has(threeDot[1])) {
            MONGO_OPS.forEach((op) => out.push({
              label: op,
              kind: monaco.languages.CompletionItemKind.Method,
              insertText: op + '($1)',
              detail: 'mongo op',
              sortText: '0' + op,
              range,
            }));
            handled = true;
          }
        }

        if (!handled) {
          // db.<dbname>.$ — collections in that DB (multi-DB)
          const dbDot = /(?:^|[\s(=,])db\.([a-zA-Z0-9_-]+)\.$/.exec(linePrefix);
          if (dbDot && isMultiDB && dbs.has(dbDot[1])) {
            collectionsIn(dbDot[1]).forEach((t) => out.push({
              label: t.name,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: t.name,
              detail: `${dbDot[1]}.${t.name}`,
              sortText: '0' + t.name,
              range,
            }));
            handled = true;
          }
        }

        if (!handled) {
          // db.<coll>.$ — collection in default DB, suggest ops
          const collDot = /(?:^|[\s(=,])db\.([a-zA-Z0-9_-]+)\.$/.exec(linePrefix);
          if (collDot && !isMultiDB) {
            MONGO_OPS.forEach((op) => out.push({
              label: op,
              kind: monaco.languages.CompletionItemKind.Method,
              insertText: op + '($1)',
              detail: 'mongo op',
              sortText: '0' + op,
              range,
            }));
            handled = true;
          }
        }

        if (!handled && /(?:^|[\s(=,])db\.$/.test(linePrefix)) {
          if (isMultiDB) {
            dbList.forEach((db) => out.push({
              label: db,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: db,
              detail: 'database',
              sortText: '0' + db,
              range,
            }));
            MONGO_SHELL_HELPERS.forEach((h) => out.push({
              label: h,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: h + "('$1')",
              detail: 'shell helper',
              sortText: '1' + h,
              range,
            }));
          } else {
            (schema?.tables ?? []).forEach((t) => out.push({
              label: t.name,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: t.name,
              detail: 'collection',
              sortText: '0' + t.name,
              range,
            }));
            MONGO_SHELL_HELPERS.forEach((h) => out.push({
              label: h,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: h + "('$1')",
              detail: 'shell helper',
              sortText: '1' + h,
              range,
            }));
          }
          handled = true;
        }

        // Inside `.find(` / inside an object literal: suggest field names
        // from the collection in scope + Mongo operators.
        if (!handled) {
          const objCtx = mongoObjectContext(textToCursor);
          if (objCtx.insideObject) {
            const target = objCtx.collection
              ? (schema?.tables ?? []).find((t) =>
                  t.name === objCtx.collection && (!objCtx.database || t.schema === objCtx.database))
              : undefined;
            if (target) {
              target.columns.forEach((c) => out.push({
                label: c.name,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: c.name,
                detail: `${target.name}.${c.type || 'field'}`,
                sortText: '0' + c.name,
                range,
              }));
            }
            MONGO_OPERATORS.forEach((o) => out.push({
              label: o,
              kind: monaco.languages.CompletionItemKind.Operator,
              insertText: o,
              sortText: '1' + o,
              range,
            }));
            // $-stages relevant when the user is inside an aggregate pipeline
            if (objCtx.op === 'aggregate') {
              MONGO_STAGES.forEach((s) => out.push({
                label: s,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: s,
                sortText: '0' + s,
                range,
              }));
            }
            handled = true;
          }
        }

        // Cursor chain methods after `).$`
        if (!handled && /\)\.[a-zA-Z]*$/.test(linePrefix)) {
          MONGO_CURSOR_METHODS.forEach((m) => out.push({
            label: m,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: m + '($1)',
            detail: 'cursor',
            sortText: '0' + m,
            range,
          }));
          handled = true;
        }
      } else {
        return { suggestions: sqlItems(monaco, model, position, range, schema?.tables ?? [], kind) };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { suggestions: out as any };
    },
  });
  providers.set(lang, disposable);
}

// mongoObjectContext walks `textToCursor` and detects whether the cursor
// is inside the first-arg object literal of a Mongo collection call —
// e.g. inside the braces of `db.x.find({ ... })`. Returns the collection
// + database in scope so the caller can surface field-name suggestions
// scoped to the right introspected document.
function mongoObjectContext(text: string): {
  insideObject: boolean;
  database?: string;
  collection?: string;
  op?: string;
} {
  // Find the innermost unbalanced `{` that's preceded by a `(` belonging
  // to a `.<op>(` call. Cheap state machine — quotes ignored.
  let inS = false, inD = false;
  let braceDepth = 0;
  let lastUnbalancedBraceParenIdx = -1;
  const parenStack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (ch === '(') parenStack.push(i);
      else if (ch === ')') parenStack.pop();
      else if (ch === '{') {
        braceDepth++;
        // remember the enclosing `(` index for the most-recent open brace
        if (parenStack.length > 0) {
          lastUnbalancedBraceParenIdx = parenStack[parenStack.length - 1];
        }
      } else if (ch === '}') {
        braceDepth--;
      }
    }
  }
  if (braceDepth <= 0 || lastUnbalancedBraceParenIdx < 0) {
    return { insideObject: false };
  }
  // Walk left from the `(` to grab the op name and chain back to db/coll.
  const head = text.slice(0, lastUnbalancedBraceParenIdx);
  const callMatch = /(?:db|getCollection\([^)]*\))(?:\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\))?(?:\.([a-zA-Z0-9_-]+))?(?:\.([a-zA-Z0-9_-]+))?\.([a-zA-Z]+)\s*$/.exec(head)
    || /db(?:\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\))?(?:\.([a-zA-Z0-9_-]+))?(?:\.([a-zA-Z0-9_-]+))?\.([a-zA-Z]+)\s*$/.exec(head);
  if (!callMatch) {
    return { insideObject: true };
  }
  const [, sibling, a, b, op] = callMatch;
  // Resolve coll: if sibling, second segment is coll; if 3 dots, b is coll, a is db; else a is coll.
  let database = sibling;
  let collection: string | undefined;
  if (sibling) {
    collection = b ?? a;
  } else if (a && b) {
    database = a;
    collection = b;
  } else {
    collection = a;
  }
  return { insideObject: true, database, collection, op };
}

// ── SQL ────────────────────────────────────────────────────────────────

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST', 'LOWER', 'UPPER',
  'TRIM', 'LENGTH', 'SUBSTRING', 'CONCAT', 'ROUND', 'ABS', 'NOW', 'DATE_TRUNC', 'EXTRACT',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'STRING_AGG', 'ARRAY_AGG', 'JSON_AGG',
];

// After a complete table reference: the clauses that can follow it.
const AFTER_TABLE_KEYWORDS = [
  'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
  'GROUP BY', 'ORDER BY', 'LIMIT', 'HAVING', 'UNION', 'UNION ALL', 'AS', 'ON',
];

// DataGrip-style live templates at the start of a statement.
const SQL_SNIPPETS: Array<{ label: string; body: string; doc: string }> = [
  { label: 'sel', body: 'SELECT * FROM ${1:table}${0}', doc: 'SELECT * FROM …' },
  { label: 'selw', body: 'SELECT * FROM ${1:table} WHERE ${2:condition}${0}', doc: 'SELECT * FROM … WHERE …' },
  { label: 'selc', body: 'SELECT COUNT(*) FROM ${1:table}${0}', doc: 'SELECT COUNT(*) FROM …' },
  { label: 'ins', body: 'INSERT INTO ${1:table} (${2:columns}) VALUES (${3:values})${0}', doc: 'INSERT INTO … VALUES …' },
  { label: 'upd', body: 'UPDATE ${1:table} SET ${2:column} = ${3:value} WHERE ${4:condition}${0}', doc: 'UPDATE … SET … WHERE …' },
  { label: 'del', body: 'DELETE FROM ${1:table} WHERE ${2:condition}${0}', doc: 'DELETE FROM … WHERE …' },
];

interface Item {
  label: string;
  kind: number;
  insertText: string;
  insertTextRules?: number;
  filterText?: string;
  detail?: string;
  documentation?: string;
  sortText?: string;
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
}

function sqlItems(
  monaco: Monaco,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  position: any,
  range: Item['range'],
  tables: DBSchemaTable[],
  kind: DBKind,
): Item[] {
  const K = monaco.languages.CompletionItemKind;
  const SNIPPET = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`dbquery:completion.${key}`, opts);
  const full: string = model.getValue();
  const offset: number = model.getOffsetAt(position);

  // The statement fragment around the caret: from the `;` before it to
  // the `;` after it (a just-started statement counts as its own).
  let fragStart = 0;
  let fragEnd = full.length;
  for (const st of splitStatements(full)) {
    if (st.stop <= offset && full[st.stop - 1] === ';') fragStart = st.stop;
    else if (st.stop > offset) { fragEnd = st.stop; break; }
  }
  const before = full.slice(fragStart, offset);
  const stmt = full.slice(fragStart, fragEnd);
  const refs = tableRefs(stmt, tables);
  const linePrefix: string = model.getLineContent(position.lineNumber).slice(0, position.column - 1);

  const ident = (s: string) => quoteIdentIfNeeded(s, kind);
  const schemaNames = new Set(tables.map((x) => x.schema ?? ''));
  const showSchema = (s?: string) => !!s && schemaNames.size > 1 && s !== 'public' && s !== 'dbo';
  const tableText = (x: DBSchemaTable) => (showSchema(x.schema) ? `${ident(x.schema!)}.${ident(x.name)}` : ident(x.name));
  const out: Item[] = [];
  const pad = (n: number) => String(n).padStart(4, '0');

  // Inside a string literal: nothing useful to suggest.
  if ((sanitize(before).match(/'/g)?.length ?? 0) % 2 === 1) return [];

  // `alias.` / `table.` / `schema.` / `schema.table.`
  const qual = qualifierBefore(linePrefix);
  if (qual) {
    const target = resolveQualifier(qual, refs, tables);
    if (target.kind === 'columns') {
      target.table.columns.forEach((c, i) => out.push({
        label: c.name,
        kind: K.Field,
        insertText: ident(c.name),
        filterText: c.name,
        detail: `${c.type} · ${target.table.name}`,
        sortText: '0' + pad(i),
        range,
      }));
    } else if (target.kind === 'tables') {
      target.tables.forEach((x) => out.push({
        label: x.name,
        kind: K.Class,
        insertText: ident(x.name),
        filterText: x.name,
        detail: t('columnsCount', { count: x.columns.length }),
        sortText: '0' + x.name,
        range,
      }));
    }
    return out;
  }

  const ctx = caretContext(before);
  const keywords = (list: string[], pri: string) => list.forEach((kw) => out.push({
    label: kw, kind: K.Keyword, insertText: kw, sortText: pri + kw, range,
  }));

  if (ctx === 'start') {
    SQL_SNIPPETS.forEach((sn) => out.push({
      label: sn.label,
      kind: K.Snippet,
      insertText: sn.body,
      insertTextRules: SNIPPET,
      detail: sn.doc,
      documentation: t('template'),
      sortText: '0' + sn.label,
      range,
    }));
    keywords(['SELECT', 'WITH', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'EXPLAIN', 'SHOW', 'CREATE', 'ALTER', 'DROP'], '1');
    return out;
  }

  if (ctx === 'table') {
    // JOIN → whole join clauses along foreign keys, DataGrip-style.
    if (/\bjoin\s+[\w$."`[\]]*$/i.test(sanitize(before))) {
      joinSuggestions(refs, tables, tableText, ident).forEach((j, i) => out.push({
        label: j.text,
        kind: K.Reference,
        insertText: j.text,
        filterText: j.target.name,
        detail: t('fkJoin'),
        sortText: '0' + pad(i),
        range,
      }));
    }
    tables.forEach((x) => out.push({
      label: tableText(x),
      kind: K.Class,
      insertText: tableText(x),
      filterText: x.name,
      detail: [showSchema(x.schema) ? '' : x.schema, t('columnsCount', { count: x.columns.length })].filter(Boolean).join(' · '),
      sortText: '1' + x.name,
      range,
    }));
    refs.filter((r) => !r.table).forEach((r) => out.push({
      label: r.name, kind: K.Class, insertText: r.name, detail: 'CTE', sortText: '0' + r.name, range,
    }));
    if (schemaNames.size > 1) {
      [...schemaNames].filter(Boolean).forEach((sc) => out.push({
        label: sc, kind: K.Module, insertText: ident(sc), detail: t('schema'), sortText: '2' + sc, range,
      }));
    }
    return out;
  }

  if (ctx === 'join-on') {
    onConditions(refs, ident).forEach((cond, i) => out.push({
      label: cond, kind: K.Reference, insertText: cond, detail: t('fkCondition'), sortText: '0' + pad(i), range,
    }));
  }

  // Right after `FROM t x ` / `JOIN t x `: the next clause is the likely word.
  const afterTableRef = /\b(?:from|join)\s+[\w$."`[\]]+(?:\s+(?:as\s+)?[\w$"`[\]]+)?\s+\w*$/i.test(sanitize(before))
    && !/\b(?:where|on|and|or|by|having|set)\s+\w*$/i.test(sanitize(before));
  if (afterTableRef) keywords(AFTER_TABLE_KEYWORDS, '0');

  // Columns of the tables in this statement first; a name that exists in
  // two of them is inserted qualified (o.id) so the query stays valid.
  const inScope = refs.filter((r) => r.table);
  if (inScope.length > 0) {
    const seen = new Map<string, number>();
    inScope.forEach((r) => r.table!.columns.forEach((c) => seen.set(c.name.toLowerCase(), (seen.get(c.name.toLowerCase()) ?? 0) + 1)));
    inScope.forEach((r, ri) => {
      const q = r.alias ?? ident(r.name);
      r.table!.columns.forEach((c, ci) => {
        const ambiguous = (seen.get(c.name.toLowerCase()) ?? 0) > 1;
        out.push({
          label: ambiguous ? `${q}.${c.name}` : c.name,
          kind: K.Field,
          insertText: ambiguous ? `${q}.${ident(c.name)}` : ident(c.name),
          filterText: c.name,
          detail: `${c.type} · ${r.alias ? `${r.alias} → ` : ''}${r.table!.name}`,
          sortText: '1' + pad(ri) + pad(ci),
          range,
        });
      });
      // Alias / table name itself, for typing `o.` next.
      out.push({ label: q, kind: K.Variable, insertText: q, detail: r.table!.name, sortText: '2' + q, range });
      // `o.*` → every column spelled out (DataGrip "expand *").
      if (ctx === 'select-list') {
        const cols = r.table!.columns.map((c) => (inScope.length > 1 ? `${q}.${ident(c.name)}` : ident(c.name))).join(', ');
        out.push({
          label: `${q}.*`,
          kind: K.Snippet,
          insertText: cols,
          filterText: `${q}.*`,
          detail: t('expandColumns', { count: r.table!.columns.length }),
          sortText: '2' + q + '*',
          range,
        });
      }
    });
  } else {
    // SELECT list typed before FROM: every column is a candidate.
    let n = 0;
    for (const x of tables) {
      for (const c of x.columns) {
        if (n++ > 3000) break;
        out.push({
          label: c.name, kind: K.Field, insertText: ident(c.name), filterText: c.name,
          detail: `${c.type} · ${x.name}`, sortText: '3' + c.name, range,
        });
      }
    }
  }

  SQL_FUNCTIONS.forEach((fn) => out.push({
    label: fn,
    kind: K.Function,
    insertText: `${fn}($0)`,
    insertTextRules: SNIPPET,
    sortText: '4' + fn,
    range,
  }));
  keywords([
    'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL', 'BETWEEN',
    'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'DISTINCT', 'GROUP BY', 'ORDER BY',
    'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'UNION',
  ], '5');
  return out;
}
