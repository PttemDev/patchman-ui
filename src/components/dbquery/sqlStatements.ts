// Statement ranges for the SQL editor: run-at-caret, the per-statement
// gutter ▶ and statement-scoped completion all use these.
//
// The rules mirror the backend's SplitSQL (be/internal/dbquery/split.go)
// so the editor and the executor agree on boundaries: a `;` inside a
// '…' / "…" string, a $tag$…$tag$ body, a `--` line comment or a
// /* … */ block does not split, and comment-only fragments are not
// statements.

export interface StatementRange {
  /** Offset of the first code character (leading blanks/comments skipped). */
  start: number;
  /** Offset just past the last code character (before `;`/trailing blanks). */
  end: number;
  /** Offset just past the terminating `;` (or the text end). */
  stop: number;
  text: string;
}

export function splitStatements(q: string): StatementRange[] {
  const out: StatementRange[] = [];
  let codeStart = -1; // first code char of the current fragment
  let codeEnd = -1; // just past the last code char
  let inSingle = false, inDouble = false, inLine = false, inBlock = false;
  let dollarTag = '';
  let prev = '';

  const markCode = (from: number, to: number) => {
    if (codeStart < 0) codeStart = from;
    codeEnd = to;
  };
  const flush = (stop: number) => {
    if (codeStart >= 0) {
      out.push({ start: codeStart, end: codeEnd, stop, text: q.slice(codeStart, codeEnd) });
    }
    codeStart = -1;
    codeEnd = -1;
  };

  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (inLine) {
      if (c === '\n') inLine = false;
      prev = c;
      continue;
    }
    if (inBlock) {
      if (prev === '*' && c === '/') inBlock = false;
      prev = c;
      continue;
    }
    if (dollarTag) {
      if (c === '$' && q.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        markCode(i, i + 1);
        dollarTag = '';
        prev = '$';
        continue;
      }
      markCode(i, i + 1);
      prev = c;
      continue;
    }
    if (inSingle) {
      markCode(i, i + 1);
      if (c === "'" && prev !== '\\') inSingle = false;
      prev = c;
      continue;
    }
    if (inDouble) {
      markCode(i, i + 1);
      if (c === '"' && prev !== '\\') inDouble = false;
      prev = c;
      continue;
    }
    if (c === '-' && q[i + 1] === '-') {
      inLine = true;
      i++;
      prev = '-';
      continue;
    }
    if (c === '/' && q[i + 1] === '*') {
      inBlock = true;
      i++;
      prev = ''; // the '*' just consumed must not close the block
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < q.length && /[A-Za-z0-9_]/.test(q[j])) j++;
      if (j < q.length && q[j] === '$') {
        dollarTag = q.slice(i, j + 1);
        markCode(i, j + 1);
        i = j;
        prev = '$';
        continue;
      }
    }
    if (c === "'") { inSingle = true; markCode(i, i + 1); }
    else if (c === '"') { inDouble = true; markCode(i, i + 1); }
    else if (c === ';') { flush(i + 1); }
    else if (!/\s/.test(c)) { markCode(i, i + 1); }
    prev = c;
  }
  flush(q.length);
  return out;
}

/**
 * The statement the caret belongs to. Inside a statement (or after its `;`
 * on the same line) → that one. Between statements, or above the first /
 * below the last → the nearest one by line distance; a tie goes to the
 * statement above (DataGrip behaviour).
 */
export function statementAt(stmts: StatementRange[], offset: number, text = ''): StatementRange | undefined {
  if (stmts.length === 0) return undefined;
  const lines = (from: number, to: number) => {
    let n = 0;
    for (let i = from; i < to; i++) if (text[i] === '\n') n++;
    return n;
  };
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (offset >= s.start && offset <= s.stop) return s;
    if (offset < s.start) {
      if (i === 0) return s;
      const prev = stmts[i - 1];
      // Still on the line where the previous statement ended → that one.
      const below = lines(prev.stop, offset);
      if (below === 0) return prev;
      const above = lines(offset, s.start);
      return above < below ? s : prev;
    }
  }
  return stmts[stmts.length - 1];
}
