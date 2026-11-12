import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { cn } from '@/lib/utils';
import type { GrafanaFrame, GrafanaPanel } from '@/types';
import {
  framesToSeries, framesToValues, framesToTable, framesToLogs, fieldDefaults, reduce, thresholdColor, mapValue,
  PALETTE, type Series,
} from '../grafanaFrames';
import { formatValue } from '../grafanaUnits';
import { HeatmapViz } from './HeatmapViz';
import { PolystatViz } from './PolystatViz';
import { StateTimelineViz } from './StateTimelineViz';

// Native renderers for the common Grafana panel types. Each takes the panel
// model + the frames its queries returned. Anything not listed in
// SUPPORTED renders an "open in Grafana" placeholder.

export const SUPPORTED = new Set([
  'timeseries', 'graph', 'stat', 'singlestat', 'gauge', 'bargauge', 'table', 'table-old', 'text',
  'piechart', 'grafana-piechart-panel', 'barchart', 'logs', 'heatmap', 'grafana-polystat-panel', 'state-timeline',
  'natel-discrete-panel',
]);

type VizProps = {
  panel: GrafanaPanel;
  frames: GrafanaFrame[];
  onZoom?: (from: number, to: number) => void;
  interpolate: (s: string) => string;
  syncId?: string;
  /** Query time range (epoch ms) — the x axis spans it, like Grafana. */
  timeRange?: [number, number];
  /** Follow a panel link (polystat click-through); Grafana dashboard links open in PatchMan. */
  onLink?: (url: string) => void;
};

function opt<T>(panel: GrafanaPanel, path: string, fallback: T): T {
  let cur: unknown = panel;
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return fallback;
  }
  return (cur ?? fallback) as T;
}

function fmt(unit?: string, decimals?: number) {
  return (v: number) => formatValue(v, unit, decimals);
}

function NoData() {
  const { t } = useTranslation('grafana');
  return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t('panel.noData')}</div>;
}

export function PanelViz(props: VizProps) {
  const type = props.panel.type;
  switch (type) {
    case 'timeseries':
    case 'graph':
      return <TimeSeriesViz {...props} />;
    case 'stat':
    case 'singlestat':
      return <StatViz {...props} />;
    case 'gauge':
      return <GaugeViz {...props} />;
    case 'bargauge':
      return <BarGaugeViz {...props} />;
    case 'table':
    case 'table-old':
      return <TableViz {...props} />;
    case 'text':
      return <TextViz {...props} />;
    case 'piechart':
    case 'grafana-piechart-panel':
      return <PieViz {...props} />;
    case 'barchart':
      return <BarChartViz {...props} />;
    case 'logs':
      return <LogsViz {...props} />;
    case 'heatmap':
      return <HeatmapViz {...props} />;
    case 'grafana-polystat-panel':
      return <PolystatViz {...props} />;
    case 'state-timeline':
    case 'natel-discrete-panel':
      return <StateTimelineViz {...props} />;
  }
  return null;
}

// ── time series ─────────────────────────────────────────────────────

function TimeSeriesViz({ panel, frames, onZoom, syncId, timeRange }: VizProps) {
  const d = fieldDefaults(panel);
  const custom = (panel.fieldConfig?.defaults?.custom ?? {}) as Record<string, unknown>;
  const legacy = panel.type === 'graph';
  const unit = legacy ? opt<string | undefined>(panel, 'yaxes.0.format', d.unit) : d.unit;
  const series = useMemo(() => framesToSeries(frames, panel), [frames, panel]);
  if (series.length === 0) return <NoData />;
  const stacking = (custom.stacking as { mode?: string } | undefined)?.mode;
  const drawStyle = legacy
    ? (opt(panel, 'bars', false) ? 'bars' : opt(panel, 'points', false) ? 'points' : 'line')
    : ((custom.drawStyle as string) || 'line');
  const fill = legacy ? Number(opt(panel, 'fill', 1)) * 10 : Number(custom.fillOpacity ?? 0);
  const legend = opt<Record<string, unknown>>(panel, 'options.legend', {});
  const legendMode = legacy
    ? (opt(panel, 'legend.show', true) ? (opt(panel, 'legend.alignAsTable', false) ? 'table' : 'list') : 'hidden')
    : legend.showLegend === false || legend.displayMode === 'hidden' ? 'hidden' : (legend.displayMode as string) === 'table' ? 'table' : 'list';
  return (
    <TimeSeriesChart
      series={series.map((s) => ({ key: s.key, name: s.name, color: s.color!, points: s.points }))}
      format={fmt(unit, d.decimals)}
      drawStyle={drawStyle as 'line' | 'bars' | 'points'}
      fillOpacity={fill}
      lineWidth={Number(custom.lineWidth ?? (legacy ? opt(panel, 'linewidth', 1) : 1))}
      spanNulls={legacy ? opt<string>(panel, 'nullPointMode', '') === 'connected' : custom.spanNulls === true}
      showPoints={legacy ? (opt(panel, 'points', false) ? 'always' : 'auto') : ((custom.showPoints as 'auto' | 'always' | 'never') ?? 'auto')}
      interpolation={legacy ? (opt(panel, 'steppedLine', false) ? 'stepAfter' : 'linear') : ((custom.lineInterpolation as 'linear' | 'smooth' | 'stepBefore' | 'stepAfter') ?? 'linear')}
      syncId={syncId}
      xDomain={timeRange}
      stack={legacy ? (opt(panel, 'stack', false) ? (opt(panel, 'percentage', false) ? 'percent' : 'normal') : 'none') : (stacking as 'normal' | 'percent' | undefined) ?? 'none'}
      min={d.min ?? (custom.axisSoftMin as number | undefined)}
      max={d.max ?? (custom.axisSoftMax as number | undefined)}
      legend={legendMode as 'list' | 'table' | 'hidden'}
      legendPlacement={(legend.placement as 'bottom' | 'right') ?? (legacy && opt(panel, 'legend.rightSide', false) ? 'right' : 'bottom')}
      legendCalcs={(legend.calcs as string[]) ?? []}
      onZoom={onZoom}
    />
  );
}

// ── stat ────────────────────────────────────────────────────────────

function reduced(panel: GrafanaPanel, frames: GrafanaFrame[]): Array<{ s: Series; value: number | null }> {
  const calc = opt<string[]>(panel, 'options.reduceOptions.calcs', [])[0]
    ?? (panel.type === 'singlestat' ? (panel.valueName as string) === 'current' ? 'lastNotNull' : (panel.valueName as string) : undefined)
    ?? 'lastNotNull';
  const series = framesToValues(frames, panel);
  return series.map((s) => ({ s, value: reduce(s.points, calc === 'avg' ? 'mean' : calc) }));
}

// Value text scaled to fit its box (Grafana shrinks stat values instead of
// cutting them); the full text is always in the tooltip. Measured on the
// rendered span itself — canvas measureText ignores tabular-nums, which
// made values a little too wide and cut them.
function FitText({ text, max, min = 10, className, style }: { text: string; max: number; min?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    const span = spanRef.current;
    if (!el || !span) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0) return;
      const prev = span.style.fontSize;
      span.style.fontSize = '100px';
      const tw = span.scrollWidth || 1;
      span.style.fontSize = prev;
      setSize(Math.max(min, Math.floor(Math.min(max, ((w * 0.94) / tw) * 100, h > 0 ? h * 0.85 : max))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, max, min]);
  return (
    <div ref={ref} className={cn('flex items-center justify-center overflow-hidden', className)} title={text}>
      <span ref={spanRef} className="font-semibold tabular-nums whitespace-nowrap leading-none truncate max-w-full" style={{ fontSize: size, ...style }}>{text}</span>
    </div>
  );
}

function StatViz({ panel, frames }: VizProps) {
  const d = fieldDefaults(panel);
  const items = useMemo(() => reduced(panel, frames), [panel, frames]);
  const colorMode = opt(panel, 'options.colorMode', 'value') as string;
  const graphMode = opt(panel, 'options.graphMode', 'area') as string;
  const textMode = opt(panel, 'options.textMode', 'auto') as string;
  if (items.length === 0) return <NoData />;
  return (
    <div className={cn('h-full grid gap-1', items.length > 1 ? 'grid-cols-[repeat(auto-fit,minmax(120px,1fr))]' : 'grid-cols-1')}>
      {items.slice(0, 48).map(({ s, value }) => {
        const mapped = mapValue(value, d);
        const color = mapped?.color ?? thresholdColor(value, d) ?? s.color ?? PALETTE[0];
        const text = mapped?.text ?? (value === null ? (d.noValue ?? '–') : formatValue(value, s.unit ?? d.unit, s.decimals ?? d.decimals));
        const bg = colorMode === 'background' || colorMode === 'background_solid';
        const showName = textMode === 'value_and_name' || textMode === 'name' || (textMode === 'auto' && items.length > 1);
        return (
          <div key={s.key} className="relative rounded flex flex-col items-center justify-center overflow-hidden min-h-0 px-1" style={bg ? { background: color } : undefined}>
            {graphMode === 'area' && s.points.length > 1 && (
              <div className="absolute inset-x-0 bottom-0 h-1/2 opacity-30 pointer-events-none">
                <TimeSeriesChart series={[{ key: s.key, name: s.name, color: bg ? '#fff' : color, points: s.points }]} format={() => ''} fillOpacity={60} legend="hidden" showPoints="never" className="[&_.recharts-cartesian-axis]:hidden [&_.recharts-cartesian-grid]:hidden" />
              </div>
            )}
            {showName && <div className={cn('relative text-[11px] truncate max-w-full shrink-0', bg ? 'text-white/90' : 'text-muted-foreground')} title={s.name}>{s.name}</div>}
            {textMode !== 'name' && (
              <FitText
                text={text}
                max={items.length > 6 ? 22 : items.length > 2 ? 30 : 44}
                className="relative flex-1 min-h-0 w-full"
                style={{ color: bg ? '#fff' : colorMode === 'none' ? undefined : color }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── gauge ───────────────────────────────────────────────────────────

function GaugeViz({ panel, frames }: VizProps) {
  const d = fieldDefaults(panel);
  const items = useMemo(() => reduced(panel, frames), [panel, frames]);
  if (items.length === 0) return <NoData />;
  const min = d.min ?? 0;
  const max = d.max ?? (d.unit === 'percentunit' ? 1 : 100);
  return (
    <div className="h-full grid gap-1 grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
      {items.slice(0, 24).map(({ s, value }) => {
        const color = thresholdColor(value, d) ?? s.color ?? PALETTE[0];
        const pct = value === null ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
        return (
          <div key={s.key} className="relative min-h-0 flex flex-col items-center justify-center">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="72%" outerRadius="100%" startAngle={210} endAngle={-30} data={[{ v: pct }]}>
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="v" background={{ fill: 'var(--color-muted)' }} fill={color} cornerRadius={4} isAnimationActive={false} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div className="relative text-xl font-semibold tabular-nums truncate max-w-[85%]" style={{ color }} title={`${s.name}: ${value === null ? '–' : formatValue(value, s.unit ?? d.unit, s.decimals ?? d.decimals)}`}>
              {value === null ? '–' : formatValue(value, s.unit ?? d.unit, s.decimals ?? d.decimals)}
            </div>
            {items.length > 1 && <div className="relative text-[10px] text-muted-foreground truncate max-w-[90%]">{s.name}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── bar gauge ───────────────────────────────────────────────────────

function BarGaugeViz({ panel, frames }: VizProps) {
  const d = fieldDefaults(panel);
  const items = useMemo(() => reduced(panel, frames), [panel, frames]);
  if (items.length === 0) return <NoData />;
  const vals = items.map((i) => i.value ?? 0);
  const min = d.min ?? Math.min(0, ...vals);
  const max = d.max ?? Math.max(...vals, 1);
  const vertical = opt<string>(panel, 'options.orientation', 'auto') === 'vertical';
  return (
    <div className={cn('h-full overflow-auto', vertical ? 'flex items-end gap-2 px-1' : 'flex flex-col justify-center gap-1.5 px-1')}>
      {items.map(({ s, value }) => {
        const color = thresholdColor(value, d) ?? s.color ?? PALETTE[0];
        const pct = value === null ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
        const label = value === null ? '–' : formatValue(value, s.unit ?? d.unit, s.decimals ?? d.decimals);
        if (vertical) {
          return (
            <div key={s.key} className="flex-1 h-full flex flex-col items-center justify-end min-w-0">
              <span className="text-[11px] tabular-nums" style={{ color }}>{label}</span>
              <div className="w-full rounded-sm" style={{ height: `${Math.max(pct, 1)}%`, background: color }} />
              <span className="text-[10px] text-muted-foreground truncate max-w-full">{s.name}</span>
            </div>
          );
        }
        return (
          <div key={s.key} className="min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[11px] text-muted-foreground truncate" title={s.name}>{s.name}</span>
              <span className="ml-auto text-[11px] font-medium tabular-nums shrink-0" style={{ color }}>{label}</span>
            </div>
            <div className="h-2.5 rounded-sm bg-muted overflow-hidden">
              <div className="h-full rounded-sm" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── table ───────────────────────────────────────────────────────────

function TableViz({ panel, frames }: VizProps) {
  const d = fieldDefaults(panel);
  const tables = useMemo(() => framesToTable(frames), [frames]);
  const [idx, setIdx] = useState(0);
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const tbl = tables[Math.min(idx, tables.length - 1)];
  const rows = useMemo(() => {
    if (!tbl) return [];
    if (!sort) return tbl.rows;
    return [...tbl.rows].sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return sort.desc ? -c : c;
    });
  }, [tbl, sort]);
  if (!tbl || tbl.columns.length === 0) return <NoData />;
  const cell = (v: unknown, col: { type?: string; unit?: string }) => {
    if (col.type === 'time' && typeof v === 'number') return new Date(v).toLocaleString();
    if (col.type === 'number') return formatValue(v, col.unit ?? d.unit, d.decimals);
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return v == null ? '' : String(v);
  };
  return (
    <div className="h-full flex flex-col min-h-0">
      {tables.length > 1 && (
        <div className="flex gap-1 pb-1 shrink-0 overflow-x-auto">
          {tables.map((_, i) => (
            <button key={i} type="button" onClick={() => setIdx(i)} className={cn('text-[10px] px-1.5 py-0.5 rounded border', i === idx ? 'bg-accent' : 'text-muted-foreground')}>
              {frames[i]?.schema.name || frames[i]?.schema.refId || `#${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-card">
            <tr>
              {tbl.columns.map((c, i) => (
                <th key={i} className="text-left font-medium text-muted-foreground px-2 py-1 border-b cursor-pointer select-none whitespace-nowrap"
                  onClick={() => setSort((s) => (s?.col === i ? { col: i, desc: !s.desc } : { col: i, desc: false }))}>
                  <span className="inline-flex items-center gap-0.5">
                    {c.name}
                    {sort?.col === i && (sort.desc ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 2000).map((r, ri) => (
              <tr key={ri} className="border-b border-border/40 hover:bg-accent/30">
                {r.map((v, ci) => (
                  <td key={ci} className={cn('px-2 py-0.5 whitespace-nowrap max-w-[420px] truncate', tbl.columns[ci].type === 'number' && 'text-right tabular-nums font-mono')} title={String(cell(v, tbl.columns[ci]))}>
                    {cell(v, tbl.columns[ci])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── text ────────────────────────────────────────────────────────────

function TextViz({ panel, interpolate }: VizProps) {
  const mode = (opt(panel, 'options.mode', (panel.mode as string) ?? 'markdown') as string);
  const content = interpolate(String(opt(panel, 'options.content', (panel.content as string) ?? '')));
  if (mode === 'code') {
    return <pre className="h-full overflow-auto text-[11px] font-mono whitespace-pre-wrap">{content}</pre>;
  }
  // HTML panels and raw HTML inside markdown go through rehype-sanitize — no
  // scripts, styles or event handlers survive.
  return (
    <div className="h-full overflow-auto text-xs prose-sm max-w-none [&_a]:text-primary [&_a]:underline [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:font-mono [&_code]:text-[11px] [&_table]:text-[11px] [&_td]:px-1 [&_th]:px-1 space-y-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── pie ─────────────────────────────────────────────────────────────

function PieViz({ panel, frames }: VizProps) {
  const d = fieldDefaults(panel);
  const items = useMemo(() => reduced(panel, frames).filter((i) => i.value !== null && i.value > 0), [panel, frames]);
  if (items.length === 0) return <NoData />;
  const donut = opt<string>(panel, 'options.pieType', 'pie') === 'donut';
  const total = items.reduce((a, i) => a + (i.value ?? 0), 0);
  return (
    <div className="h-full flex gap-2 min-h-0">
      <div className="flex-1 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items.map((i) => ({ name: i.s.name, value: i.value }))} dataKey="value" nameKey="name" innerRadius={donut ? '55%' : 0} outerRadius="90%" isAnimationActive={false} stroke="var(--color-card)">
              {items.map((i, k) => <Cell key={i.s.key} fill={i.s.color ?? PALETTE[k % PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => formatValue(v, d.unit, d.decimals)} contentStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="w-[40%] max-w-[220px] overflow-auto text-[11px] space-y-0.5 py-1">
        {items.map((i, k) => (
          <div key={i.s.key} className="flex items-center gap-1.5 min-w-0">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: i.s.color ?? PALETTE[k % PALETTE.length] }} />
            <span className="truncate">{i.s.name}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">{Math.round(((i.value ?? 0) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── bar chart (categorical) ─────────────────────────────────────────

function BarChartViz({ panel, frames }: VizProps) {
  const d = fieldDefaults(panel);
  const data = useMemo(() => {
    const f = frames[0];
    if (!f) return null;
    const xIdx = f.schema.fields.findIndex((x) => x.type === 'string' || x.type === 'time');
    const nums = f.schema.fields.map((x, i) => (x.type === 'number' ? i : -1)).filter((i) => i >= 0);
    if (xIdx < 0 || !nums.length) return null;
    const n = f.data.values[xIdx]?.length ?? 0;
    const rows = Array.from({ length: n }, (_, r) => {
      const row: Record<string, unknown> = { x: f.schema.fields[xIdx].type === 'time' ? new Date(Number(f.data.values[xIdx][r])).toLocaleString() : f.data.values[xIdx][r] };
      for (const i of nums) row[f.schema.fields[i].name] = f.data.values[i][r];
      return row;
    });
    return { rows, keys: nums.map((i) => f.schema.fields[i].name) };
  }, [frames]);
  if (!data) return <TimeSeriesViz panel={{ ...panel, fieldConfig: { ...panel.fieldConfig, defaults: { ...(panel.fieldConfig?.defaults ?? {}), custom: { drawStyle: 'bars' } } } }} frames={frames} interpolate={(s) => s} />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="x" tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} stroke="var(--color-border)" />
        <YAxis width={56} tickFormatter={(v: number) => formatValue(v, d.unit, d.decimals)} tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} stroke="var(--color-border)" />
        <Tooltip formatter={(v: number) => formatValue(v, d.unit, d.decimals)} contentStyle={{ fontSize: 11 }} />
        {data.keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── logs ────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  error: 'bg-red-500', err: 'bg-red-500', crit: 'bg-red-700', critical: 'bg-red-700', fatal: 'bg-red-700',
  warn: 'bg-amber-500', warning: 'bg-amber-500', info: 'bg-emerald-500', debug: 'bg-sky-500', trace: 'bg-violet-500',
};

export function LogsViz({ frames }: VizProps) {
  const rows = useMemo(() => framesToLogs(frames), [frames]);
  const [open, setOpen] = useState<number | null>(null);
  if (rows.length === 0) return <NoData />;
  return (
    <div className="h-full overflow-auto font-mono text-[11px]">
      {rows.slice(0, 1000).map((r, i) => (
        <div key={i} className="border-b border-border/30">
          <button type="button" onClick={() => setOpen((o) => (o === i ? null : i))} className="w-full flex items-start gap-2 px-1 py-0.5 text-left hover:bg-accent/30">
            <span className={cn('mt-1 h-2 w-1 rounded-sm shrink-0', LEVEL_COLOR[(r.level ?? '').toLowerCase()] ?? 'bg-muted-foreground/40')} />
            <span className="text-muted-foreground shrink-0">{new Date(r.t).toLocaleString()}</span>
            <span className="whitespace-pre-wrap break-all">{r.line}</span>
          </button>
          {open === i && (
            <div className="pl-6 pb-1 flex flex-wrap gap-1">
              {Object.entries(r.labels).map(([k, v]) => (
                <span key={k} className="rounded bg-muted px-1 text-[10px]">{k}=<span className="text-foreground">{v}</span></span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function UnsupportedViz({ panel, link }: { panel: GrafanaPanel; link?: string }) {
  const { t } = useTranslation('grafana');
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1 text-center text-xs text-muted-foreground px-3">
      <div>{t('panel.unsupported', { type: panel.type || '?' })}</div>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ExternalLink className="h-3 w-3" /> {t('panel.openInGrafana')}
        </a>
      )}
    </div>
  );
}
