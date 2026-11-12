import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  Table as TableIcon,
  Braces,
  BarChart3,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { useThemeStore } from '@/stores/themeStore';
import { DBJsonModal, canShowAsJson } from '@/components/dbquery/DBJsonModal';

interface ESResultViewerProps {
  /** Raw ES response body for the active run. */
  body: unknown;
  /** HTTP status + BE round-trip time for the meta strip. */
  status: number;
  tookMs: number;
}

type ResultView = 'hits' | 'raw' | 'aggs';

// ESResultViewer renders one ES response: a flattenable hits table (with
// _id/_index/_score), a read-only raw-JSON pane, and an aggregations tree —
// plus a meta strip (took / total / shards / status) and JSON/CSV/xlsx export.
export function ESResultViewer({ body, status, tookMs }: ESResultViewerProps) {
  const { t } = useTranslation('es');
  const { theme } = useThemeStore();
  const [view, setView] = useState<ResultView>('raw');
  const [flatten, setFlatten] = useState(true);
  const [cell, setCell] = useState<{ colName: string; value: unknown } | null>(null);
  const [row, setRow] = useState<Record<string, unknown> | null>(null);

  const obj = (body ?? {}) as Record<string, unknown>;
  const hitsBlock = (obj.hits ?? {}) as Record<string, unknown>;
  const rawHits = Array.isArray(hitsBlock.hits) ? (hitsBlock.hits as Array<Record<string, unknown>>) : [];
  const aggregations = obj.aggregations as Record<string, unknown> | undefined;
  const hasAggs = !!aggregations && Object.keys(aggregations).length > 0;

  // Every new response opens on Raw — it always shows the full body and never
  // an empty table. The user switches to Hits / Aggregations when they want the
  // structured views.
  useEffect(() => {
    setView('raw');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const total = useMemo(() => normalizeTotal(hitsBlock.total), [hitsBlock.total]);
  const shards = obj._shards as Record<string, unknown> | undefined;

  const { columns, rows } = useMemo(() => buildHitRows(rawHits, flatten), [rawHits, flatten]);

  const rawText = useMemo(() => {
    try { return JSON.stringify(body ?? {}, null, 2); } catch { return String(body); }
  }, [body]);

  const handleExport = (fmt: 'json' | 'csv' | 'xlsx') => {
    if (fmt === 'json') {
      triggerDownload(new Blob([rawText], { type: 'application/json' }), 'es-response.json');
      return;
    }
    if (fmt === 'xlsx') {
      const sheet = XLSX.utils.json_to_sheet(
        rows.map((r) => Object.fromEntries(columns.map((c) => [c, normalizeCell(r[c])]))),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, 'Hits');
      XLSX.writeFile(wb, 'es-hits.xlsx');
      return;
    }
    const header = columns.map(csvEscape).join(',');
    const lines = rows.map((r) => columns.map((c) => csvEscape(stringify(r[c]))).join(','));
    triggerDownload(new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' }), 'es-hits.csv');
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* Meta strip */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b text-[11px] text-muted-foreground bg-muted/30 shrink-0 flex-wrap">
        <span className="flex items-center gap-1">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              status >= 200 && status < 300 ? 'bg-emerald-500' : 'bg-destructive',
            )}
          />
          <span className="font-mono text-foreground">{status || '—'}</span>
        </span>
        <span>·</span>
        <span><span className="font-mono text-foreground">{tookMs}</span> {t('result.msRoundTrip')}</span>
        {typeof obj.took === 'number' && (
          <>
            <span>·</span>
            <span>ES <span className="font-mono text-foreground">{obj.took as number}</span> ms</span>
          </>
        )}
        {total && (
          <>
            <span>·</span>
            <span>
              <span className="font-mono text-foreground">{total.value.toLocaleString()}</span>
              {total.relation === 'gte' ? '+' : ''} {t('result.hits')}
            </span>
          </>
        )}
        {shards && (
          <>
            <span>·</span>
            <span>
              {t('result.shards')} <span className="font-mono text-foreground">{String(shards.successful ?? '?')}</span>/
              <span className="font-mono">{String(shards.total ?? '?')}</span>
              {typeof shards.failed === 'number' && shards.failed > 0 && (
                <span className="text-destructive"> · {t('result.shardsFailed', { count: shards.failed })}</span>
              )}
            </span>
          </>
        )}

        <div className="flex-1" />

        <div className="flex border rounded">
          <ViewBtn icon={<TableIcon className="h-3 w-3" />} label={t('result.viewHits')} active={view === 'hits'} onClick={() => setView('hits')} />
          <ViewBtn icon={<Braces className="h-3 w-3" />} label={t('result.viewRaw')} active={view === 'raw'} onClick={() => setView('raw')} />
          {hasAggs && (
            <ViewBtn icon={<BarChart3 className="h-3 w-3" />} label={t('result.viewAggs')} active={view === 'aggs'} onClick={() => setView('aggs')} />
          )}
        </div>

        {view === 'hits' && (
          <Button
            size="sm"
            variant="ghost"
            className={cn('h-7 text-[11px] gap-1.5', flatten && 'text-primary')}
            onClick={() => setFlatten((f) => !f)}
            title={t('result.flattenTitle')}
          >
            {flatten ? t('result.flattened') : t('result.flatten')}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
              <Download className="h-3 w-3" />
              {t('result.export')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport('xlsx')}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-2" /> {t('result.exportXlsx')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('csv')}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-2" /> {t('result.exportCsv')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('json')}>
              <FileJson className="h-3.5 w-3.5 mr-2" /> {t('result.exportJson')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'hits' && (
          rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground gap-2">
              <Info className="h-4 w-4" />
              {t('result.noHits', { aggs: hasAggs ? t('result.orAggregations') : '' })}
            </div>
          ) : (
            <HitsTable
              columns={columns}
              rows={rows}
              onPickCell={(colName, value) => setCell({ colName, value })}
              onPickRow={(r) => setRow(r)}
            />
          )
        )}
        {view === 'raw' && (
          <CodeEditor
            height="100%"
            language="json"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={rawText}
            options={{
              readOnly: true,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />
        )}
        {view === 'aggs' && aggregations && (
          <div className="h-full overflow-auto p-3">
            <AggsView aggs={aggregations} />
          </div>
        )}
      </div>

      <DBJsonModal
        open={!!cell}
        onClose={() => setCell(null)}
        value={cell?.value}
        colName={cell?.colName}
      />
      <DBJsonModal
        open={!!row}
        onClose={() => setRow(null)}
        value={row}
        colName="document"
      />
    </div>
  );
}

function HitsTable({
  columns, rows, onPickCell, onPickRow,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  onPickCell: (colName: string, value: unknown) => void;
  onPickRow: (row: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation('es');
  return (
    <div className="h-full overflow-auto">
      <table className="text-xs border-collapse w-max min-w-full">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr>
            <th className="px-2 py-1 text-left font-medium text-muted-foreground border-b border-r w-10">#</th>
            {columns.map((c) => (
              <th
                key={c}
                className={cn(
                  'px-2 py-1 text-left font-mono font-medium border-b border-r whitespace-nowrap',
                  c.startsWith('_') ? 'text-sky-500' : 'text-foreground',
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-accent/30 group">
              <td
                className="px-2 py-1 border-b border-r text-muted-foreground font-mono cursor-pointer align-top"
                onClick={() => onPickRow(r)}
                title={t('result.inspectDocument')}
              >
                {i + 1}
              </td>
              {columns.map((c) => {
                const v = r[c];
                return (
                  <td
                    key={c}
                    className="px-2 py-1 border-b border-r align-top max-w-[360px]"
                    onClick={() => { if (canShowAsJson(v)) onPickCell(c, v); }}
                  >
                    <CellValue value={v} clickable={canShowAsJson(v)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellValue({ value, clickable }: { value: unknown; clickable: boolean }) {
  if (value == null) return <span className="text-muted-foreground/50 italic">null</span>;
  if (typeof value === 'object') {
    return (
      <span className={cn('font-mono text-[11px] text-amber-500', clickable && 'cursor-pointer underline decoration-dotted')}>
        {Array.isArray(value) ? `[${(value as unknown[]).length}]` : '{…}'}
      </span>
    );
  }
  if (typeof value === 'boolean') return <span className="text-emerald-500">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-purple-500 font-mono">{value}</span>;
  return <span className="truncate inline-block max-w-[360px] align-bottom">{String(value)}</span>;
}

// AggsView renders ES aggregation output as a nested tree: bucket aggs become
// compact tables (key · doc_count · metrics); metric aggs render as a value.
function AggsView({ aggs, depth = 0 }: { aggs: Record<string, unknown>; depth?: number }) {
  return (
    <div className={cn('space-y-2', depth > 0 && 'pl-3 border-l border-border/60')}>
      {Object.entries(aggs).map(([name, val]) => (
        <AggNode key={name} name={name} value={val} depth={depth} />
      ))}
    </div>
  );
}

function AggNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const { t } = useTranslation('es');
  const v = (value ?? {}) as Record<string, unknown>;
  const buckets = Array.isArray(v.buckets) ? (v.buckets as Array<Record<string, unknown>>) : null;

  if (buckets) {
    // Sub-agg (nested) columns are any bucket keys beyond key/doc_count/key_as_string.
    const metricKeys = Array.from(
      new Set(
        buckets.flatMap((b) =>
          Object.keys(b).filter((k) => !['key', 'key_as_string', 'doc_count'].includes(k)),
        ),
      ),
    );
    return (
      <div>
        <p className="text-[11px] font-semibold text-foreground/90 mb-1">
          {name} <span className="text-muted-foreground font-normal">· {t('result.buckets', { count: buckets.length })}</span>
        </p>
        <div className="overflow-auto">
          <table className="text-[11px] border-collapse">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-2 py-0.5 text-left border-b border-r font-medium">key</th>
                <th className="px-2 py-0.5 text-right border-b border-r font-medium">doc_count</th>
                {metricKeys.map((mk) => (
                  <th key={mk} className="px-2 py-0.5 text-right border-b border-r font-medium font-mono">{mk}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                <tr key={i} className="hover:bg-accent/20">
                  <td className="px-2 py-0.5 border-b border-r font-mono">{String(b.key_as_string ?? b.key)}</td>
                  <td className="px-2 py-0.5 border-b border-r text-right font-mono text-purple-500">{String(b.doc_count)}</td>
                  {metricKeys.map((mk) => (
                    <td key={mk} className="px-2 py-0.5 border-b border-r text-right font-mono">{renderMetric(b[mk])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Metric agg (value/values) or a plain scalar.
  if ('value' in v || 'values' in v) {
    return (
      <p className="text-[11px]">
        <span className="font-semibold text-foreground/90">{name}</span>
        <span className="text-muted-foreground"> = </span>
        <span className="font-mono text-purple-500">{renderMetric('value' in v ? v.value : v.values)}</span>
      </p>
    );
  }

  // Nested sub-aggregation object — recurse over the non-meta keys.
  const nested = Object.fromEntries(
    Object.entries(v).filter(([k]) => !['doc_count', 'key', 'key_as_string'].includes(k)),
  );
  if (Object.keys(nested).length > 0) {
    return (
      <div>
        <p className="text-[11px] font-semibold text-foreground/90 mb-1">{name}</p>
        <AggsView aggs={nested} depth={depth + 1} />
      </div>
    );
  }
  return (
    <p className="text-[11px]">
      <span className="font-semibold text-foreground/90">{name}</span>
      <span className="text-muted-foreground"> = </span>
      <span className="font-mono">{stringify(value)}</span>
    </p>
  );
}

function renderMetric(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ViewBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn('h-7 px-2 text-[11px] rounded-none gap-1', active && 'bg-accent')}
    >
      {icon}
      {label}
    </Button>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function normalizeTotal(total: unknown): { value: number; relation: string } | null {
  if (total == null) return null;
  if (typeof total === 'number') return { value: total, relation: 'eq' };
  if (typeof total === 'object') {
    const t = total as { value?: number; relation?: string };
    if (typeof t.value === 'number') return { value: t.value, relation: t.relation ?? 'eq' };
  }
  return null;
}

function buildHitRows(
  hits: Array<Record<string, unknown>>,
  flatten: boolean,
): { columns: string[]; rows: Record<string, unknown>[] } {
  const meta = ['_id', '_index', '_score'];
  const seen = new Set<string>();
  const rows = hits.map((h) => {
    const base: Record<string, unknown> = {
      _id: h._id,
      _index: h._index,
      _score: h._score,
    };
    const src = (h._source ?? {}) as Record<string, unknown>;
    const flat = flatten ? flattenObject(src, '') : src;
    for (const k of Object.keys(flat)) { base[k] = flat[k]; seen.add(k); }
    return base;
  });
  const columns = [...meta, ...Array.from(seen)];
  return { columns, rows };
}

function flattenObject(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v as Record<string, unknown>, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function normalizeCell(v: unknown): unknown {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return v;
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
