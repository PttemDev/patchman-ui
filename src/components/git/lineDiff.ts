// Line diff for the editor's change markers (GIT_IDE_PLAN §H): Myers O(ND)
// over lines, folded into hunks the gutter can paint and roll back.

export interface ChangeHunk {
  kind: 'added' | 'modified' | 'deleted';
  /** 1-based first line in the new text (for deleted: the line after the gap). */
  newStart: number;
  /** number of new lines (0 for deleted) */
  newCount: number;
  /** the old lines this hunk replaces */
  oldLines: string[];
}

// Caps memory (the trace keeps one V per step) on wildly different files.
const MAX_D = 1500;

/** Myers shortest edit script; returns, per old/new line, whether it is kept. null if too different. */
function myers(a: string[], b: string[]): { keepA: boolean[]; keepB: boolean[] } | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_D);
  const off = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  if (!found) return null;
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const prevX = vv[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; keepA[x] = true; keepB[y] = true; }
    if (d > 0) { x = prevX; y = prevY; }
  }
  return { keepA, keepB };
}

export function diffHunks(oldText: string, newText: string): ChangeHunk[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const r = myers(a, b);
  if (!r) return [];
  const hunks: ChangeHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && r.keepA[i] && r.keepB[j]) { i++; j++; continue; }
    const oldStart = i;
    const newStart = j;
    while (i < a.length && !r.keepA[i]) i++;
    while (j < b.length && !r.keepB[j]) j++;
    const oldLines = a.slice(oldStart, i);
    const newCount = j - newStart;
    if (!oldLines.length && !newCount) { i++; j++; continue; }
    hunks.push({
      kind: !oldLines.length ? 'added' : !newCount ? 'deleted' : 'modified',
      newStart: newStart + 1,
      newCount,
      oldLines,
    });
  }
  return hunks;
}
