import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, Scatter,
} from 'recharts';
import { cn } from '@/lib/utils';
import { timeTickFormatter, timeTicks } from './timeFormat';

// Multi-series time chart shared by the Grafana panels (and anything else
// that has {t, v} series): line / area / bars / points, optional stacking,
// a Grafana-like legend (click = isolate a series), unit-aware ticks and
// drag-to-zoom.

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  points: Array<{ t: number; v: number | null }>;
}

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  format: (v: number) => string;
  drawStyle?: 'line' | 'bars' | 'points';
  /** 0–100; > 0 draws an area. */
  fillOpacity?: number;
  lineWidth?: number;
  /** Connect across null gaps (Grafana "Connect null values"). */
  spanNulls?: boolean;
  /** Grafana "Show points": auto = only when the series is sparse. */
  showPoints?: 'auto' | 'always' | 'never';
  /** Grafana lineInterpolation. */
  interpolation?: 'linear' | 'smooth' | 'stepBefore' | 'stepAfter';
  /** Charts with the same syncId share the hover position (crosshair). */
  syncId?: string;
  /** X axis range in epoch ms (the query's time range, like Grafana); the
   *  data extent when omitted. */
  xDomain?: [number, number];
  stack?: 'none' | 'normal' | 'percent';
  min?: number;
  max?: number;
  legend?: 'list' | 'table' | 'hidden';
  legendPlacement?: 'bottom' | 'right';
  /** Show these calcs in table legends. */
  legendCalcs?: string[];
  onZoom?: (from: number, to: number) => void;
  className?: string;
}

const tickStyle = { fontSize: 10, fill: 'var(--color-muted-foreground)' };

function calc(points: Array<{ v: number | null }>, c: string): number | null {
  const nn = points.map((p) => p.v).filter((v): v is number => v !== null);
  if (!nn.length) return null;
  switch (c) {
    case 'max': return Math.max(...nn);
    case 'min': return Math.min(...nn);
    case 'mean': return nn.reduce((a, b) => a + b, 0) / nn.length;
    case 'sum': return nn.reduce((a, b) => a + b, 0);
    case 'first':
    case 'firstNotNull': return nn[0];
    default: return nn[nn.length - 1];
  }
}

export function TimeSeriesChart({
  series, format, drawStyle = 'line', fillOpacity = 0, lineWidth = 1, spanNulls = false, showPoints = 'auto', interpolation = 'linear', syncId, xDomain, stack = 'none', min, max,
  legend = 'list', legendPlacement = 'bottom', legendCalcs, onZoom, className,
}: TimeSeriesChartProps) {
  const [isolated, setIsolated] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ a: number; b?: number } | null>(null);

  const visible = useMemo(() => (isolated ? series.filter((s) => s.key === isolated) : series), [series, isolated]);

  const { rows, span, ticks } = useMemo(() => {
    const byT = new Map<number, Record<string, number | null>>();
    for (const s of visible) {
      for (const p of s.points) {
        let row = byT.get(p.t);
        if (!row) { row = { t: p.t }; byT.set(p.t, row); }
        row[s.key] = p.v;
      }
    }
    const out = [...byT.values()].sort((a, b) => (a.t as number) - (b.t as number));
    if (stack === 'percent') {
      for (const r of out) {
        const total = visible.reduce((a, s) => a + Math.abs((r[s.key] as number) ?? 0), 0);
        for (const s of visible) if (r[s.key] != null && total) r[s.key] = ((r[s.key] as number) / total) * 100;
      }
    }
    const ts = out.map((r) => r.t as number);
    const lo = xDomain ? xDomain[0] : ts[0] ?? 0;
    const hi = xDomain ? xDomain[1] : ts[ts.length - 1] ?? 0;
    return { rows: out, span: hi - lo, ticks: timeTicks(lo, hi, 6) };
  }, [visible, stack, xDomain]);

  const fmtTime = useMemo(() => timeTickFormatter(span), [span]);
  // Series whose points are mostly separated by gaps would draw nothing as
  // a gap-respecting line — show their points (Grafana's showPoints: auto).
  const sparse = useMemo(() => {
    const out = new Set<string>();
    if (spanNulls) return out;
    for (const s of visible) {
      // Mostly isolated points, or runs so short the line is a stub.
      let isolated = 0;
      let nonNull = 0;
      let runs = 0;
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][s.key];
        if (v == null) continue;
        nonNull++;
        const prev = i > 0 ? rows[i - 1][s.key] : null;
        const next = i < rows.length - 1 ? rows[i + 1][s.key] : null;
        if (prev == null) runs++;
        if (prev == null && next == null) isolated++;
      }
      if (nonNull > 0 && (isolated / nonNull > 0.3 || nonNull / runs < 4)) out.add(s.key);
    }
    return out;
  }, [visible, rows, spanNulls]);
  const dotFor = (key: string, color: string) => {
    if (showPoints === 'never') return false;
    if (showPoints === 'always' || rows.length < 3 || sparse.has(key)) return { r: 2, fill: color, stroke: color };
    return false;
  };
  const curve = interpolation === 'smooth' ? 'monotone' : interpolation === 'stepBefore' ? 'stepBefore' : interpolation === 'stepAfter' ? 'stepAfter' : 'linear';
  const gradPrefix = useMemo(() => `tsc-${Math.random().toString(36).slice(2, 8)}`, []);
  const yFormat = stack === 'percent' ? (v: number) => `${Math.round(v)}%` : format;
  const stackId = stack === 'none' ? undefined : 's';
  const domain: [number | string, number | string] = [min ?? 'auto', max ?? 'auto'];

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        syncId={syncId}
        syncMethod="value"
        margin={{ top: 6, right: 10, bottom: 0, left: 0 }}
        onMouseDown={onZoom ? (e) => { if (e?.activeLabel != null) setDrag({ a: Number(e.activeLabel) }); } : undefined}
        onMouseMove={onZoom ? (e) => { if (drag && e?.activeLabel != null) setDrag({ ...drag, b: Number(e.activeLabel) }); } : undefined}
        onMouseUp={onZoom ? () => {
          if (drag?.b != null && drag.b !== drag.a) onZoom(Math.min(drag.a, drag.b), Math.max(drag.a, drag.b));
          setDrag(null);
        } : undefined}
      >
        <defs>
          {visible.map((s, i) => (
            <linearGradient key={s.key} id={`${gradPrefix}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={Math.min(1, Math.max(fillOpacity, stack === 'none' ? 0 : 40) / 100)} />
              <stop offset="100%" stopColor={s.color} stopOpacity={Math.min(1, Math.max(fillOpacity, stack === 'none' ? 0 : 40) / 100) * 0.12} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t" type="number" scale="time" domain={xDomain ?? ['dataMin', 'dataMax']} allowDataOverflow={!!xDomain}
          ticks={ticks} tickFormatter={fmtTime} minTickGap={30} tick={tickStyle} stroke="var(--color-border)" tickLine={false}
        />
        <YAxis width={68} tickFormatter={(v: number) => yFormat(v)} tick={tickStyle} stroke="var(--color-border)" tickLine={false} domain={domain} allowDataOverflow={min != null || max != null} />
        <Tooltip
          isAnimationActive={false}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const items = [...payload]
              .filter((p) => p.value != null)
              .sort((a, b) => Number(b.value) - Number(a.value))
              .slice(0, 20);
            return (
              <div className="rounded border bg-popover px-2 py-1.5 text-[11px] shadow-md max-w-[360px]">
                <div className="text-muted-foreground mb-1">{new Date(Number(label)).toLocaleString()}</div>
                {items.map((p) => (
                  <div key={String(p.dataKey)} className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.color }} />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto pl-3 font-mono tabular-nums">{yFormat(Number(p.value))}</span>
                  </div>
                ))}
                {payload.length > items.length && <div className="text-muted-foreground mt-0.5">+{payload.length - items.length}</div>}
              </div>
            );
          }}
        />
        {visible.map((s, i) => {
          if (drawStyle === 'bars') {
            return <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stackId} isAnimationActive={false} />;
          }
          if (drawStyle === 'points') {
            return <Scatter key={s.key} dataKey={s.key} name={s.name} fill={s.color} isAnimationActive={false} />;
          }
          if (fillOpacity > 0 || stackId) {
            return (
              <Area
                key={s.key} type={curve} dataKey={s.key} name={s.name} stroke={s.color} fill={`url(#${gradPrefix}-${i})`}
                fillOpacity={1} strokeWidth={lineWidth} stackId={stackId}
                dot={dotFor(s.key, s.color)} isAnimationActive={false} connectNulls={spanNulls}
              />
            );
          }
          return (
            <Line
              key={s.key} type={curve} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={lineWidth}
              dot={dotFor(s.key, s.color)} isAnimationActive={false} connectNulls={spanNulls}
            />
          );
        })}
        {drag?.b != null && <ReferenceArea x1={drag.a} x2={drag.b} strokeOpacity={0.3} fill="var(--color-primary)" fillOpacity={0.12} />}
      </ComposedChart>
    </ResponsiveContainer>
  );

  if (legend === 'hidden' || series.length === 0) return <div className={cn('h-full w-full', className)}>{chart}</div>;

  const legendEl = legend === 'table' ? (
    <div className="overflow-auto text-[11px]">
      <table className="w-full">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal px-1">&nbsp;</th>
            {(legendCalcs?.length ? legendCalcs : ['lastNotNull']).map((c) => <th key={c} className="text-right font-normal px-1">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.key} className={cn('cursor-pointer hover:bg-accent/40', isolated && isolated !== s.key && 'opacity-40')} onClick={() => setIsolated((v) => (v === s.key ? null : s.key))}>
              <td className="px-1 max-w-[260px]"><span className="flex items-center gap-1.5 min-w-0"><span className="h-2 w-3 rounded-sm shrink-0" style={{ background: s.color }} /><span className="truncate">{s.name}</span></span></td>
              {(legendCalcs?.length ? legendCalcs : ['lastNotNull']).map((c) => {
                const v = calc(s.points, c);
                return <td key={c} className="px-1 text-right font-mono tabular-nums">{v == null ? '–' : format(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className={cn('flex gap-x-3 gap-y-0.5 text-[11px] overflow-auto', legendPlacement === 'right' ? 'flex-col' : 'flex-wrap')}>
      {series.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => setIsolated((v) => (v === s.key ? null : s.key))}
          className={cn('flex items-center gap-1.5 min-w-0 max-w-full text-left hover:text-foreground', isolated && isolated !== s.key ? 'opacity-40' : 'text-foreground/80')}
          title={s.name}
        >
          <span className="h-2 w-3 rounded-sm shrink-0" style={{ background: s.color }} />
          <span className="truncate">{s.name}</span>
        </button>
      ))}
    </div>
  );

  if (legendPlacement === 'right') {
    return (
      <div className={cn('h-full w-full flex gap-2', className)}>
        <div className="flex-1 min-w-0">{chart}</div>
        <div className="w-[38%] max-w-[320px] min-w-[120px] overflow-auto">{legendEl}</div>
      </div>
    );
  }
  return (
    <div className={cn('h-full w-full flex flex-col gap-1', className)}>
      <div className="flex-1 min-h-0">{chart}</div>
      <div className="shrink-0 max-h-[38%] overflow-auto">{legendEl}</div>
    </div>
  );
}
