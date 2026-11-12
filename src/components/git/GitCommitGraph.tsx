import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, GitCommitHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { timeAgo } from './util';
import type { GitCommit } from '@/types';

export interface GitRef {
  name: string;
  kind: 'branch' | 'head';
}

interface GitCommitGraphProps {
  commits: GitCommit[];
  /** sha → refs whose tip is that commit (branch chips / HEAD). */
  refsBySha?: Record<string, GitRef[]>;
  selectedSha?: string | null;
  onSelect: (commit: GitCommit) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

// ── Lane assignment (commit-graph DAG) ───────────────────────────────────────
// Standard client-side lane algorithm over `parents[]`, processing commits in
// received order (newest first). `lanes[i]` holds the sha each open lane is
// waiting to render next; lane indices are STABLE for a lane's lifetime (we
// only ever null-free a lane, never shift columns), which makes edge drawing a
// straight index lookup between adjacent rows.
//
// Per commit:
//   1. lanes already expecting this sha collapse into its (leftmost) lane —
//      the extras are merge parents and close.
//   2. if no lane expected it, it takes the first free lane (or a new one).
//   3. its lane then continues to parents[0]; each additional parent opens a
//      new lane (a branch/fork point).
// Parents outside the fetched window simply keep their lane open past the last
// visible row — nothing dereferences a missing commit, so pagination is safe.
interface Graph {
  cols: number[];
  lanesAfter: (string | null)[][];
  laneCount: number;
}

function computeGraph(commits: GitCommit[]): Graph {
  const lanes: (string | null)[] = [];
  const cols: number[] = [];
  const lanesAfter: (string | null)[][] = [];
  let laneCount = 0;

  const firstFree = (): number => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const sha = commit.sha;
    const matched: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === sha) matched.push(i);

    let col: number;
    if (matched.length > 0) {
      col = matched[0];
      // Extra lanes that expected this commit are merge parents — collapse them.
      for (let k = 1; k < matched.length; k++) lanes[matched[k]] = null;
    } else {
      col = firstFree();
    }

    const parents = commit.parents ?? [];
    // The commit's own lane continues to its first parent (or closes at a root).
    lanes[col] = parents.length > 0 ? parents[0] : null;
    // Additional parents fork off into fresh lanes.
    for (let p = 1; p < parents.length; p++) {
      const pc = firstFree();
      lanes[pc] = parents[p];
    }

    cols.push(col);
    lanesAfter.push(lanes.slice());
    laneCount = Math.max(laneCount, lanes.length);
  }

  return { cols, lanesAfter, laneCount };
}

const LANE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  '#6366f1', '#84cc16',
];
const laneColor = (i: number) => LANE_COLORS[((i % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];

const LANE_W = 14;
const ROW_H = 30;
const DOT_R = 4;
const PAD_L = 10;
const x = (col: number) => PAD_L + col * LANE_W;
const yMid = (row: number) => row * ROW_H + ROW_H / 2;

interface Edge {
  fromCol: number;
  toCol: number;
  row: number; // upper row index
  color: string;
}

// GitCommitGraph draws the commit DAG with hand-rolled SVG: colored vertical
// lane tracks, bezier edges connecting a commit to each parent, a dot per
// commit, and ref chips on branch/HEAD tips. The SVG overlays the row list
// (pointer-events-none) so a click anywhere on a row selects that commit.
export function GitCommitGraph({
  commits, refsBySha, selectedSha, onSelect, onLoadMore, hasMore, loadingMore,
}: GitCommitGraphProps) {
  const { t } = useTranslation('git');
  const { cols, lanesAfter, laneCount } = useMemo(() => computeGraph(commits), [commits]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (let i = 0; i < commits.length - 1; i++) {
      const after = lanesAfter[i];
      const lower = commits[i + 1];
      const lowerCol = cols[i + 1];
      for (let L = 0; L < after.length; L++) {
        const expect = after[L];
        if (expect === null) continue;
        const toCol = expect === lower.sha ? lowerCol : L;
        out.push({ fromCol: L, toCol, row: i, color: laneColor(L) });
      }
    }
    return out;
  }, [commits, cols, lanesAfter]);

  const graphWidth = PAD_L * 2 + Math.max(1, laneCount) * LANE_W;
  const svgHeight = Math.max(commits.length * ROW_H, ROW_H);

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-10">
        <GitCommitHorizontal className="h-8 w-8 opacity-40" />
        <p className="text-xs">{t('graph.noCommits')}</p>
      </div>
    );
  }

  return (
    <div className="relative" style={{ minWidth: graphWidth + 260 }}>
      {/* Graph overlay — purely visual, clicks fall through to the rows. */}
      <svg
        className="absolute left-0 top-0 pointer-events-none"
        width={graphWidth}
        height={svgHeight}
        style={{ overflow: 'visible' }}
      >
        {edges.map((e, idx) => {
          const x1 = x(e.fromCol);
          const y1 = yMid(e.row);
          const x2 = x(e.toCol);
          const y2 = yMid(e.row + 1);
          if (x1 === x2) {
            return <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.color} strokeWidth={1.5} />;
          }
          const cy = (y1 + y2) / 2;
          return (
            <path
              key={idx}
              d={`M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`}
              fill="none"
              stroke={e.color}
              strokeWidth={1.5}
            />
          );
        })}
        {/* Continuation stubs for lanes still open past the last row. */}
        {lanesAfter[commits.length - 1]?.map((expect, L) =>
          expect === null ? null : (
            <line
              key={`stub-${L}`}
              x1={x(L)}
              y1={yMid(commits.length - 1)}
              x2={x(L)}
              y2={yMid(commits.length - 1) + ROW_H / 2}
              stroke={laneColor(L)}
              strokeWidth={1.5}
              strokeDasharray="2 2"
            />
          ),
        )}
        {commits.map((c, i) => (
          <circle
            key={c.sha}
            cx={x(cols[i])}
            cy={yMid(i)}
            r={DOT_R}
            fill={laneColor(cols[i])}
            stroke={selectedSha === c.sha ? 'currentColor' : 'hsl(var(--background))'}
            strokeWidth={selectedSha === c.sha ? 2 : 1.5}
          />
        ))}
      </svg>

      {/* Commit rows */}
      <div>
        {commits.map((c, i) => {
          const refs = refsBySha?.[c.sha] ?? [];
          return (
            <button
              key={c.sha}
              type="button"
              onClick={() => onSelect(c)}
              style={{ height: ROW_H, paddingLeft: graphWidth }}
              className={cn(
                'w-full flex items-center gap-2 pr-3 text-left text-xs transition-colors border-l-2',
                selectedSha === c.sha
                  ? 'bg-accent/70 border-primary'
                  : 'border-transparent hover:bg-accent/40',
              )}
            >
              {refs.map((r) => (
                <span
                  key={`${r.kind}:${r.name}`}
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none',
                    r.kind === 'head'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                  )}
                  title={r.kind === 'head' ? t('graph.headTitle', { name: r.name }) : r.name}
                >
                  {r.name}
                </span>
              ))}
              <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-14 truncate">
                {c.shortSha}
              </span>
              <span className="truncate flex-1 min-w-0 text-foreground/90">{c.title || c.message}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground truncate max-w-[110px]" title={c.authorName}>
                {c.authorName}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground w-16 text-right tabular-nums">
                {timeAgo(c.authoredAt)}
              </span>
            </button>
          );
        })}
      </div>

      {hasMore && (
        <div className="p-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
            {t('graph.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
