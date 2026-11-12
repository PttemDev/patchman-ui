import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, Code2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GrafanaFrame, GrafanaPanel } from '@/types';
import { PanelViz, LogsViz } from './panels/PanelViz';
import { framesToSeries, framesToTable, reduce } from './grafanaFrames';
import { defaultViewFor, tableToCSV } from './resultUtils';
import { formatValue } from './grafanaUnits';

// Query results for Explore and the panel query inspector: graph / table /
// logs / per-series stats, CSV download and the query Grafana actually ran
// (frame meta.executedQueryString — handy to see variables resolved).

export type ResultViewKind = 'graph' | 'table' | 'logs' | 'stats';

export interface QueryOutcome {
  frames: GrafanaFrame[];
  errors: string[];
  notice?: string;
  ms: number;
  /** Query time range (epoch ms) for the graph's x axis. */
  from?: number;
  to?: number;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResultView({ outcome, panel, unit, onZoom, fileName = 'query-result' }: {
  outcome: QueryOutcome | null;
  /** Panel model used to draw graph / table (units, field config). */
  panel?: GrafanaPanel;
  unit?: string;
  onZoom?: (from: number, to: number) => void;
  fileName?: string;
}) {
  const { t } = useTranslation('grafana');
  const frames = useMemo(() => outcome?.frames ?? [], [outcome]);
  const [view, setView] = useState<ResultViewKind>('graph');
  const [showExecuted, setShowExecuted] = useState(false);
  useEffect(() => { if (outcome) setView(defaultViewFor(outcome.frames)); }, [outcome]);

  const tables = useMemo(() => framesToTable(frames), [frames]);
  const series = useMemo(() => framesToSeries(frames, panel), [frames, panel]);
  const executed = useMemo(() => {
    const out: string[] = [];
    for (const f of frames) {
      const q = (f.schema.meta as { executedQueryString?: string } | undefined)?.executedQueryString;
      if (q && !out.includes(q)) out.push(q);
    }
    return out;
  }, [frames]);
  const rowCount = tables.reduce((a, tb) => a + tb.rows.length, 0);
  const vizPanel: GrafanaPanel = useMemo(() => ({
    ...(panel ?? {}),
    type: view === 'graph' ? 'timeseries' : view === 'logs' ? 'logs' : 'table',
    fieldConfig: panel?.fieldConfig ?? { defaults: { unit, custom: { fillOpacity: 8 } } },
    options: { ...(panel?.options ?? {}), legend: { displayMode: 'list' } },
  }), [panel, view, unit]);
  const fmt = (v: number | null, u?: string) => (v === null ? '–' : formatValue(v, u ?? unit ?? (panel?.fieldConfig?.defaults?.unit as string | undefined)));

  if (!outcome) return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t('explore.empty')}</div>;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground pb-1.5">
        {(['graph', 'table', 'logs', 'stats'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} className={cn('px-2 py-0.5 rounded', view === v ? 'bg-accent text-foreground' : 'hover:text-foreground')}>
            {t(`explore.view.${v}`)}
          </button>
        ))}
        <span className="ml-2">{outcome.ms > 0 ? t('results.summary', { frames: frames.length, rows: rowCount, ms: outcome.ms }) : t('results.summaryNoTime', { frames: frames.length, rows: rowCount })}</span>
        {outcome.notice && <span>· {outcome.notice}</span>}
        <span className="ml-auto flex items-center gap-1">
          {executed.length > 0 && (
            <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 px-2" onClick={() => setShowExecuted((v) => !v)}>
              {showExecuted ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}<Code2 className="h-3 w-3" /> {t('results.executed')}
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-6 text-[11px] gap-1 px-2" disabled={tables.length === 0}
            onClick={() => tables.forEach((tb, i) => download(`${fileName}${tables.length > 1 ? `-${i + 1}` : ''}.csv`, tableToCSV(tb)))}
          >
            <Download className="h-3 w-3" /> CSV
          </Button>
        </span>
      </div>
      {showExecuted && executed.length > 0 && (
        <pre className="shrink-0 mb-1.5 max-h-28 overflow-auto rounded bg-muted/50 p-2 text-[11px] font-mono whitespace-pre-wrap break-all">{executed.join('\n\n')}</pre>
      )}
      {outcome.errors.length > 0 && (
        <div className="shrink-0 mb-1.5 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive flex gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <div className="min-w-0 space-y-0.5">{outcome.errors.map((e, i) => <div key={i} className="break-words">{e}</div>)}</div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {view === 'logs' ? (
          <LogsViz panel={{ type: 'logs' }} frames={frames} interpolate={(s) => s} />
        ) : view === 'stats' ? (
          series.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t('panel.noData')}</div>
          ) : (
            <div className="h-full overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-muted-foreground">
                    {(['name', 'last', 'min', 'max', 'avg', 'sum', 'count'] as const).map((k) => (
                      <th key={k} className={cn('font-medium px-2 py-1 border-b', k === 'name' ? 'text-left' : 'text-right')}>{t(`results.stat.${k}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.key} className="border-b border-border/40 hover:bg-accent/30">
                      <td className="px-2 py-0.5 max-w-[360px]">
                        <span className="flex items-center gap-1.5 min-w-0" title={s.name}>
                          <span className="h-2 w-3 rounded-sm shrink-0" style={{ background: s.color }} /><span className="truncate">{s.name}</span>
                        </span>
                      </td>
                      {(['lastNotNull', 'min', 'max', 'mean', 'sum'] as const).map((c) => (
                        <td key={c} className="px-2 py-0.5 text-right font-mono tabular-nums">{fmt(reduce(s.points, c), s.unit)}</td>
                      ))}
                      <td className="px-2 py-0.5 text-right font-mono tabular-nums">{s.points.filter((p) => p.v !== null).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <PanelViz panel={vizPanel} frames={frames} interpolate={(s) => s} onZoom={onZoom} timeRange={outcome.from && outcome.to ? [outcome.from, outcome.to] : undefined} />
        )}
      </div>
    </div>
  );
}
