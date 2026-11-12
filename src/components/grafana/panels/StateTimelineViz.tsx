import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { timeTicks, timeTickFormatter } from '@/components/charts/timeFormat';
import type { GrafanaFrame, GrafanaPanel } from '@/types';
import { PALETTE, cssColor, fieldDefaults, framesToSeries, mapValue, overrideProps, thresholdColor, type FieldDefaults } from '../grafanaFrames';
import { formatValue } from '../grafanaUnits';

// state-timeline (and the legacy natel-discrete-panel, converted on the fly):
// one row per series, consecutive equal values merged into colored segments.
// Canvas-drawn like the heatmap; hover shows the segment, drag zooms.

type Opts = Record<string, unknown>;

const FONT = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
const AXIS_X = 16;

interface Segment { from: number; to: number; text: string; color: string; value: number | null }
interface Row { name: string; segments: Segment[] }

const CONTINUOUS: Record<string, string[]> = {
  GrYlRd: ['#73BF69', '#FADE2A', '#F2495C'],
  RdYlGr: ['#F2495C', '#FADE2A', '#73BF69'],
  BlYlRd: ['#5794F2', '#FADE2A', '#F2495C'],
  YlRd: ['#FADE2A', '#F2495C'],
  YlBl: ['#FADE2A', '#5794F2'],
  BlPu: ['#5794F2', '#B877D9'],
  blues: ['#C0D8FF', '#1F60C4'],
  reds: ['#FFA6B0', '#C4162A'],
  greens: ['#C8F2C2', '#37872D'],
  purples: ['#DEB6F2', '#8F3BB8'],
};

function hexRGB(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function gradient(stops: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hexRGB(stops[i]);
  const b = hexRGB(stops[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * (x - i)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** natel-discrete-panel → an equivalent state-timeline panel model. */
function discreteAsStateTimeline(panel: GrafanaPanel): GrafanaPanel {
  const colorOf = new Map<string, string>();
  for (const c of (panel.colorMaps as Opts[] | undefined) ?? []) colorOf.set(String(c.text ?? ''), String(c.color ?? ''));
  const values: Record<string, { text: string; color?: string }> = {};
  const mappings: Opts[] = [];
  for (const m of (panel.valueMaps as Opts[] | undefined) ?? []) {
    const text = String(m.text ?? '');
    if (m.value === 'null') mappings.push({ type: 'special', options: { match: 'null', result: { text, color: colorOf.get(text) } } });
    else values[String(m.value)] = { text, color: colorOf.get(text) };
  }
  if (Object.keys(values).length) mappings.unshift({ type: 'value', options: values });
  for (const m of (panel.rangeMaps as Opts[] | undefined) ?? []) {
    if (m.from === 'null') continue;
    const text = String(m.text ?? '');
    mappings.push({ type: 'range', options: { from: Number(m.from), to: Number(m.to), result: { text, color: colorOf.get(text) } } });
  }
  return {
    ...panel,
    type: 'state-timeline',
    fieldConfig: { defaults: { unit: panel.units, decimals: panel.decimals, mappings, color: { mode: 'palette-classic' } }, overrides: [] },
    options: { showValue: 'auto', mergeValues: true, rowHeight: 0.85, legend: { showLegend: panel.showLegend !== false } },
    discreteColors: Object.fromEntries(colorOf),
  };
}

function buildRows(panel: GrafanaPanel, frames: GrafanaFrame[], end?: number): Row[] {
  const d = fieldDefaults(panel);
  const merge = (panel.options as Opts | undefined)?.mergeValues !== false;
  const byText = (panel.discreteColors ?? {}) as Record<string, string>;
  const series = framesToSeries(frames, panel);
  const distinct = new Map<string, string>();
  return series.map((s) => {
    const ov = overrideProps(panel, s.name);
    const colorCfg = ((ov.color ?? d.color) ?? {}) as { mode?: string; fixedColor?: string };
    const nums = s.points.map((p) => p.v).filter((v): v is number => v !== null);
    const min = d.min ?? Math.min(...nums);
    const max = d.max ?? Math.max(...nums);
    const unit = (ov.unit as string | undefined) ?? d.unit;
    const dd: FieldDefaults = { ...d, unit };
    const describe = (v: number | null): { text: string; color: string } | null => {
      const m = mapValue(v, dd);
      const text = m?.text ?? (v === null ? '' : formatValue(v, unit, d.decimals));
      if (v === null && !m) return null;
      let color: string | undefined = m?.color ?? byText[text];
      const mode = colorCfg.mode ?? 'thresholds';
      if (!color && mode === 'fixed') color = cssColor(colorCfg.fixedColor);
      if (!color && mode.startsWith('continuous-') && v !== null) {
        color = gradient(CONTINUOUS[mode.slice('continuous-'.length)] ?? CONTINUOUS.GrYlRd, max > min ? (v - min) / (max - min) : 1);
      }
      if (!color && mode === 'thresholds' && (d.thresholds?.steps?.length ?? 0) > 1) color = thresholdColor(v, dd);
      if (!color) {
        if (!distinct.has(text)) distinct.set(text, PALETTE[distinct.size % PALETTE.length]);
        color = distinct.get(text)!;
      }
      return { text, color };
    };
    const segs: Segment[] = [];
    const pts = s.points;
    for (let i = 0; i < pts.length; i++) {
      const info = describe(pts[i].v);
      const next = i + 1 < pts.length ? pts[i + 1].t : (end ?? pts[i].t + (i > 0 ? pts[i].t - pts[i - 1].t : 0));
      if (!info) continue;
      const last = segs[segs.length - 1];
      if (merge && last && last.text === info.text && last.color === info.color && last.to === pts[i].t) last.to = next;
      else segs.push({ from: pts[i].t, to: next, text: info.text, color: info.color, value: pts[i].v });
    }
    return { name: s.name.trim(), segments: segs };
  });
}

function textColor(bg: string): string {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(bg);
  const [r, g, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : /^#[0-9a-f]{6}$/i.test(bg) ? hexRGB(bg) : [80, 80, 80];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}

function fmtTime(ms: number, span: number) {
  const d = new Date(ms);
  return span > 86_400_000
    ? `${d.toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function StateTimelineViz({ panel: rawPanel, frames, onZoom, timeRange }: {
  panel: GrafanaPanel;
  frames: GrafanaFrame[];
  onZoom?: (from: number, to: number) => void;
  timeRange?: [number, number];
}) {
  const { t } = useTranslation('grafana');
  const panel = useMemo(() => (rawPanel.type === 'natel-discrete-panel' ? discreteAsStateTimeline(rawPanel) : rawPanel), [rawPanel]);
  const rows = useMemo(() => buildRows(panel, frames, timeRange?.[1]), [panel, frames, timeRange]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<{ left: number; top: number; plotW: number; plotH: number; x0: number; x1: number; rowH: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ r: number; s: number; mx: number; my: number } | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  const o = (panel.options ?? {}) as Opts;
  const rowHeight = Math.min(1, Math.max(0.2, Number(o.rowHeight ?? 0.9)));
  const showValue = String(o.showValue ?? 'auto');
  const legend = (o.legend ?? {}) as Opts;
  const showLegend = legend.showLegend !== false && legend.displayMode !== 'hidden';

  const legendItems = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) for (const s of r.segments) if (!m.has(s.text)) m.set(s.text, s.color);
    return [...m.entries()].slice(0, 24);
  }, [rows]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const extent = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const r of rows) for (const s of r.segments) { a = Math.min(a, s.from); b = Math.max(b, s.to); }
    return [a, b] as const;
  }, [rows]);

  useLayoutEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap || rows.length === 0 || size.w < 20 || size.h < 20) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;
    const muted = getComputedStyle(wrap).color;
    let maxW = 0;
    for (const r of rows) maxW = Math.max(maxW, ctx.measureText(r.name).width);
    const left = Math.min(Math.ceil(maxW) + 10, Math.floor(size.w / 3));
    const top = 2;
    const plotW = Math.max(10, size.w - left - 6);
    const plotH = Math.max(10, size.h - top - AXIS_X);
    const x0 = timeRange?.[0] ?? extent[0];
    const x1 = timeRange?.[1] ?? extent[1];
    const rowH = plotH / rows.length;
    layoutRef.current = { left, top, plotW, plotH, x0, x1, rowH };
    const X = (tm: number) => left + ((tm - x0) / (x1 - x0 || 1)) * plotW;
    const barH = Math.max(2, rowH * rowHeight);
    const valueFont = `${Math.max(9, Math.min(13, barH * 0.45))}px ui-sans-serif, system-ui, sans-serif`;
    rows.forEach((r, ri) => {
      const y = top + ri * rowH + (rowH - barH) / 2;
      for (const s of r.segments) {
        const a = Math.max(left, X(s.from));
        const b = Math.min(left + plotW, X(s.to));
        if (b <= a) continue;
        ctx.fillStyle = s.color;
        ctx.fillRect(a, y, Math.max(1, b - a - (b - a > 3 ? 1 : 0)), barH);
        if (showValue !== 'never' && s.text) {
          ctx.font = valueFont;
          const w = ctx.measureText(s.text).width;
          if (showValue === 'always' || w + 6 < b - a) {
            ctx.fillStyle = textColor(s.color);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.text, (a + b) / 2, y + barH / 2, b - a);
          }
        }
      }
      ctx.font = FONT;
      ctx.fillStyle = muted;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.name, left - 6, top + (ri + 0.5) * rowH, left - 8);
    });
    ctx.font = FONT;
    ctx.fillStyle = muted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const fmt = timeTickFormatter(x1 - x0);
    for (const tk of timeTicks(x0, x1, Math.max(2, Math.floor(plotW / 90)))) {
      const label = fmt(tk);
      const w = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(Math.max(X(tk) - w / 2, left), left + plotW - w), top + plotH + 3);
    }
  }, [rows, size, timeRange, extent, rowHeight, showValue]);

  if (rows.length === 0 || rows.every((r) => r.segments.length === 0)) {
    return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t('panel.noData')}</div>;
  }

  const L = layoutRef.current;
  const pos = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  };
  const timeAt = (mx: number) => (L ? L.x0 + ((Math.min(Math.max(mx, L.left), L.left + L.plotW) - L.left) / L.plotW) * (L.x1 - L.x0) : 0);
  const hit = (mx: number, my: number) => {
    if (!L || mx < L.left || mx > L.left + L.plotW || my < L.top || my > L.top + L.plotH) return null;
    const r = Math.min(rows.length - 1, Math.floor((my - L.top) / L.rowH));
    const tm = timeAt(mx);
    const s = rows[r].segments.findIndex((x) => tm >= x.from && tm < x.to);
    return s < 0 ? null : { r, s };
  };
  const seg = hover ? rows[hover.r].segments[hover.s] : null;
  const span = L ? L.x1 - L.x0 : 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div ref={wrapRef} className="relative flex-1 min-h-0 text-muted-foreground select-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ width: size.w, height: size.h, cursor: onZoom ? 'crosshair' : undefined }}
          onMouseMove={(e) => {
            const { mx, my } = pos(e);
            if (drag) setDrag({ ...drag, b: mx });
            const h = hit(mx, my);
            setHover(h ? { ...h, mx, my } : null);
          }}
          onMouseLeave={() => { setHover(null); setDrag(null); }}
          onMouseDown={(e) => { if (onZoom && e.button === 0) { const { mx } = pos(e); setDrag({ a: mx, b: mx }); } }}
          onMouseUp={() => {
            if (drag && onZoom && Math.abs(drag.a - drag.b) > 4) {
              const a = timeAt(Math.min(drag.a, drag.b));
              const b = timeAt(Math.max(drag.a, drag.b));
              if (b > a) onZoom(Math.round(a), Math.round(b));
            }
            setDrag(null);
          }}
        />
        {drag && L && Math.abs(drag.a - drag.b) > 1 && (
          <div
            className="absolute pointer-events-none bg-primary/15 border-x border-primary/50"
            style={{ left: Math.max(L.left, Math.min(drag.a, drag.b)), width: Math.abs(drag.a - drag.b), top: L.top, height: L.plotH }}
          />
        )}
        {seg && hover && !drag && (
          <div
            className="absolute z-10 pointer-events-none rounded-md border bg-popover text-popover-foreground shadow-md px-2 py-1.5 text-[11px] space-y-0.5 whitespace-nowrap"
            style={{
              left: hover.mx + 12 + 220 > size.w ? undefined : hover.mx + 12,
              right: hover.mx + 12 + 220 > size.w ? size.w - hover.mx + 12 : undefined,
              top: Math.min(hover.my + 12, Math.max(0, size.h - 70)),
            }}
          >
            <div className="font-medium">{rows[hover.r].name}</div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm" style={{ background: seg.color }} />
              <span className="font-mono">{seg.text || '–'}</span>
            </div>
            <div className="text-muted-foreground">{fmtTime(seg.from, span)} – {fmtTime(seg.to, span)}</div>
          </div>
        )}
      </div>
      {showLegend && legendItems.length > 0 && (
        <div className="shrink-0 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground max-h-10 overflow-hidden">
          {legendItems.map(([text, color]) => (
            <span key={text} className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: color }} />{text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
