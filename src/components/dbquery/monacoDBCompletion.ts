import type { Monaco } from '@monaco-editor/react';
import { useDBConnectionStore } from '@/stores/dbConnectionStore';
import type { DBKind } from '@/types';

// One completion-provider disposable per (language, connection_id).
// We re-key on connection id so two tabs against different connections
// can each surface their own schema without cross-pollination.
const registered = new Map<string, () => void>();

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'ON',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL',
  'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'LIMIT', 'OFFSET', 'WITH', 'UNION', 'INTERSECT', 'EXCEPT',
  'EXPLAIN', 'SHOW', 'DESCRIBE',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST',
  'DATE_TRUNC', 'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'INTERVAL',
];

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
 * registerDBCompletion wires a Monaco completion provider for the
 * connection's SQL or Mongo language using the FE-side schema cache.
 * Subsequent calls with the same key are no-ops (the prior provider
 * remains active) — schemas are watched out-of-band via the store and
 * suggestions pick them up live.
 */
export function registerDBCompletion(monaco: Monaco, connectionId: string, kind: DBKind) {
  const lang = kind === 'mongo' ? 'javascript' : 'sql';
  const key = `${lang}:${connectionId}`;
  if (registered.has(key)) return;

  const disposable = monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.', ' ', '('],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const schemas = useDBConnectionStore.getState().schemas;
      const schema = schemas[connectionId];

      const suggestions: ReturnType<Monaco['languages']['CompletionItemKind'] extends infer _ ? never : never>[] = [];
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

        const siblingCollMatch = /db\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\)\.[a-zA-Z0-9_\-]+\.$/.exec(linePrefix);
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
          const threeDot = /^|.*[\s(=,]?db\.([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\.$/.exec(linePrefix);
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
          const dbDot = /(?:^|[\s(=,])db\.([a-zA-Z0-9_\-]+)\.$/.exec(linePrefix);
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
          const collDot = /(?:^|[\s(=,])db\.([a-zA-Z0-9_\-]+)\.$/.exec(linePrefix);
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
        // SQL — sort priority via leading digit in sortText:
        //   '0' = primary suggestions for this context (top of list)
        //   '1' = secondary
        //   '2' = noisy fallback
        // We also handle "table." → list only that table's columns.
        const lineToCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const fullText: string = model.getValue();
        const offset: number = model.getOffsetAt(position);
        const stmt = currentStatement(fullText.slice(0, offset));
        const ctx = sqlContext(stmt);

        // `tablename.` qualifier — narrow to that single table's columns.
        const qualMatch = /(?:^|[\s(,=])([a-zA-Z_][\w]*)\.$/.exec(lineToCursor);
        if (qualMatch && schema) {
          const target = qualMatch[1].toLowerCase();
          const t = schema.tables.find((x) => x.name.toLowerCase() === target);
          if (t) {
            t.columns.forEach((c) => out.push({
              label: c.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: c.name,
              detail: `${t.name}.${c.type}`,
              sortText: '0' + c.name,
              range,
            }));
            return { suggestions: out as any };
          }
        }

        const tablePri = ctx === 'after-from' || ctx === 'after-join' ? '0' : ctx === 'default' ? '1' : '2';
        const columnPri = ctx === 'after-from' || ctx === 'after-join' ? '2' : '0';
        const keywordPri = ctx === 'default' ? '0' : '3';

        SQL_KEYWORDS.forEach((kw) => out.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          sortText: keywordPri + kw,
          range,
        }));
        schema?.tables.forEach((t) => {
          const qualified = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
          out.push({
            label: qualified,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: qualified,
            detail: 'table',
            sortText: tablePri + qualified,
            range,
          });
          t.columns.forEach((c) => {
            out.push({
              label: c.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: c.name,
              detail: `${t.name}.${c.type}`,
              sortText: columnPri + c.name,
              range,
            });
          });
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { suggestions: out as any };
      void suggestions;
    },
  });

  registered.set(key, () => disposable.dispose());
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
  const callMatch = /(?:db|getCollection\([^)]*\))(?:\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\))?(?:\.([a-zA-Z0-9_\-]+))?(?:\.([a-zA-Z0-9_\-]+))?\.([a-zA-Z]+)\s*$/.exec(head)
    || /db(?:\.getSiblingDB\(\s*['"]([^'"]+)['"]\s*\))?(?:\.([a-zA-Z0-9_\-]+))?(?:\.([a-zA-Z0-9_\-]+))?\.([a-zA-Z]+)\s*$/.exec(head);
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

type SqlContext = 'after-from' | 'after-join' | 'select-list' | 'after-where' | 'default';

// currentStatement slices `text` to the portion belonging to the active
// SQL statement (the chars after the most recent unquoted `;`).
function currentStatement(text: string): string {
  // Cheap approximation: ignore semicolons inside single/double quotes.
  let inS = false, inD = false, last = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (ch === ';' && !inS && !inD) last = i;
  }
  return last >= 0 ? text.slice(last + 1) : text;
}

// sqlContext returns where the cursor sits relative to the most recent
// SQL clause keyword in the current statement.
function sqlContext(stmt: string): SqlContext {
  // Pad with a space so word-boundary matches at start work.
  const u = ' ' + stmt.toUpperCase() + ' ';
  const tableCtx: Array<[string, SqlContext]> = [
    [' FROM ', 'after-from'],
    [' UPDATE ', 'after-from'],
    [' INTO ', 'after-from'],
    [' JOIN ', 'after-join'],
    [' LEFT JOIN ', 'after-join'],
    [' RIGHT JOIN ', 'after-join'],
    [' INNER JOIN ', 'after-join'],
    [' FULL JOIN ', 'after-join'],
  ];
  const colCtx: Array<[string, SqlContext]> = [
    [' WHERE ', 'after-where'],
    [' ON ', 'after-where'],
    [' AND ', 'after-where'],
    [' OR ', 'after-where'],
    [' GROUP BY ', 'after-where'],
    [' ORDER BY ', 'after-where'],
    [' HAVING ', 'after-where'],
    [' SET ', 'after-where'],
  ];
  let bestIdx = -1;
  let bestCtx: SqlContext = 'default';
  for (const [kw, c] of [...tableCtx, ...colCtx]) {
    const i = u.lastIndexOf(kw);
    if (i > bestIdx) { bestIdx = i; bestCtx = c; }
  }
  if (bestIdx >= 0) return bestCtx;
  // SELECT … (no FROM yet) → cursor is in the select list, prefer columns.
  if (/\bSELECT\b/.test(u)) return 'select-list';
  return 'default';
}

/** Tear down a provider, e.g. when a connection is deleted. */
export function disposeDBCompletion(connectionId: string, kind: DBKind) {
  const lang = kind === 'mongo' ? 'javascript' : 'sql';
  const key = `${lang}:${connectionId}`;
  const off = registered.get(key);
  if (off) {
    off();
    registered.delete(key);
  }
}
