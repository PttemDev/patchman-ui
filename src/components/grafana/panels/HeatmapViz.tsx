import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { timeTicks, timeTickFormatter } from '@/components/charts/timeFormat';
import { useThemeStore } from '@/stores/themeStore';
import type { GrafanaFrame, GrafanaPanel } from '@/types';
import { fieldDefaults } from '../grafanaFrames';
import { formatValue } from '../grafanaUnits';
import { buildHeatmap, heatmapColor, isLegacyHeatmap, type Heatmap } from '../heatmapData';

// Heatmap panel (new and legacy): drawn on a canvas — a 24h range at 15s
// resolution is thousands of columns × dozens of buckets. Hover shows the
// cell, drag zooms the time range like the time series panels.

const FONT = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
const PAD_TOP = 4;
const PAD_RIGHT = 6;
const AXIS_X = 16;

type Layout = { left: number; top: number; plotW: number; plotH: number; x0: number; x1: number };

function get<T>(o: unknown, path: string): T | undefined {
  let cur: unknown = o;
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur as T;
}

function fmtTime(ms: number, span: number) {
  const d = new Date(ms);
  return span > 86_400_000
    ? `${d.toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function HeatmapViz({ panel, frames, onZoom, timeRange }: {
  panel: GrafanaPanel;
  frames: GrafanaFrame[];
  onZoom?: (from: number, to: number) => void;
  timeRange?: [number, number];
}) {
  const { t } = useTranslation('grafana');
  const dark = useThemeStore((s) => s.theme === 'dark');
  const data = useMemo(() => buildHeatmap(frames, panel), [frames, panel]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ c: number; r: number; mx: number; my: number } | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  const legacy = isLegacyHeatmap(panel);
  const d = fieldDefaults(panel);
  const yUnit = legacy ? get<string>(panel, 'yAxis.format') : (get<string>(panel, 'options.yAxis.unit') ?? d.unit);
  const yDecimals = legacy ? get<number>(panel, 'yAxis.decimals') : (get<number>(panel, 'options.yAxis.decimals') ?? d.decimals);
  const cellUnit = legacy ? undefined : get<string>(panel, 'options.cellValues.unit');
  const cellDecimals = legacy ? undefined : get<number>(panel, 'options.cellValues.decimals');
  const gap = Math.max(0, Number(legacy ? get(panel, 'cards.cardPadding') ?? 1 : get(panel, 'options.cellGap') ?? 1) || 0);
  const reverseY = !legacy && get(panel, 'options.yAxis.reverse') === true;
  const showY = legacy ? get(panel, 'yAxis.show') !== false : get(panel, 'options.yAxis.axisPlacement') !== 'hidden';
  const showLegend = legacy ? get(panel, 'legend.show') === true : get(panel, 'options.legend.show') !== false;
  const showTooltip = legacy ? get(panel, 'tooltip.show') !== false : get(panel, 'options.tooltip.mode') !== 'none' && get(panel, 'options.tooltip.show') !== false;
  const color = useMemo(() => (data ? heatmapColor(panel, data, dark, '#FA6400') : null), [panel, data, dark]);

  const yLabel = (hm: Heatmap, r: number) => {
    const row = hm.rows[r];
    if (!hm.numeric || row.value === null) return row.label;
    if (row.value === Infinity) return '+Inf';
    return formatValue(row.value, yUnit, yDecimals);
  };
  const cellText = (v: number) => formatValue(v, cellUnit, cellDecimals);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap || !data || !color || size.w < 20 || size.h < 20) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;
    const textColor = getComputedStyle(wrap).color;

    const R = data.rows.length;
    let left = 2;
    if (showY) {
      let maxW = 0;
      for (let r = 0; r < R; r++) maxW = Math.max(maxW, ctx.measureText(yLabel(data, r)).width);
      left = Math.min(Math.ceil(maxW) + 8, Math.floor(size.w / 3));
    }
    const top = PAD_TOP;
    const plotW = Math.max(10, size.w - left - PAD_RIGHT);
    const plotH = Math.max(10, size.h - top - AXIS_X);
    const x0 = timeRange?.[0] ?? data.xs[0] - data.step;
    const x1 = timeRange?.[1] ?? data.xs[data.xs.length - 1];
    layoutRef.current = { left, top, plotW, plotH, x0, x1 };
    const X = (tm: number) => left + ((tm - x0) / (x1 - x0 || 1)) * plotW;
    const rowH = plotH / R;
    // Gaps only between cells big enough to keep them: thin columns with a
    // 1px gap read as stripes.
    const gy = rowH >= 4 ? gap : 0;

    const cache = new Map<number, string>();
    for (let c = 0; c < data.xs.length; c++) {
      let xa = X(data.xs[c] - data.step);
      let xb = X(data.xs[c]);
      if (xb <= left || xa >= left + plotW) continue;
      xa = Math.max(xa, left);
      xb = Math.min(xb, left + plotW);
      const gx = xb - xa >= 4 ? gap : 0;
      for (let r = 0; r < R; r++) {
        const v = data.cells[c * R + r];
        if (!(v > data.hideLe)) continue;
        const tn = color.norm(v);
        let fill = cache.get(tn);
        if (!fill) { fill = color.at(tn); cache.set(tn, fill); }
        ctx.fillStyle = fill;
        ctx.globalAlpha = color.opacity ? Math.max(0.08, tn) : 1;
        const y = top + (reverseY ? r : R - 1 - r) * rowH;
        ctx.fillRect(xa + gx / 2, y + gy / 2, Math.max(1, xb - xa - gx), Math.max(1, rowH - gy));
      }
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = textColor;
    if (showY) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const every = Math.max(1, Math.ceil((R * 13) / plotH));
      for (let r = 0; r < R; r += every) {
        const y = top + ((reverseY ? r : R - 1 - r) + 0.5) * rowH;
        ctx.fillText(yLabel(data, r), left - 4, y);
      }
    }
    ctx.textBaseline = 'top';
    const fmt = timeTickFormatter(x1 - x0);
    for (const tk of timeTicks(x0, x1, Math.max(2, Math.floor(plotW / 90)))) {
      const x = X(tk);
      const label = fmt(tk);
      const w = ctx.measureText(label).width;
      ctx.textAlign = 'left';
      ctx.fillText(label, Math.min(Math.max(x - w / 2, left), left + plotW - w), top + plotH + 3);
    }
    // yLabel only depends on the unit settings listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, color, size, gap, reverseY, showY, timeRange, yUnit, yDecimals]);

  if (!data || data.empty) {
    return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t('panel.noData')}</div>;
  }

  const hit = (mx: number, my: number) => {
    const L = layoutRef.current;
    if (!L || mx < L.left || mx > L.left + L.plotW || my < L.top || my > L.top + L.plotH) return null;
    const tm = L.x0 + ((mx - L.left) / L.plotW) * (L.x1 - L.x0);
    const c = Math.ceil((tm - data.xs[0]) / data.step);
    if (c < 0 || c >= data.xs.length) return null;
    const R = data.rows.length;
    const k = Math.min(R - 1, Math.floor((my - L.top) / (L.plotH / R)));
    return { c, r: reverseY ? k : R - 1 - k };
  };
  const timeAt = (mx: number) => {
    const L = layoutRef.current!;
    return L.x0 + ((Math.min(Math.max(mx, L.left), L.left + L.plotW) - L.left) / L.plotW) * (L.x1 - L.x0);
  };
  const pos = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  };

  const hv = hover ? data.cells[hover.c * data.rows.length + hover.r] : NaN;
  const L = layoutRef.current;
  const span = L ? L.x1 - L.x0 : 0;
  const row = hover ? data.rows[hover.r] : null;
  const bucket = row && data.numeric && row.lo !== null && row.hi !== null
    ? `${formatValue(row.lo, yUnit, yDecimals)} – ${row.hi === Infinity ? '+Inf' : formatValue(row.hi, yUnit, yDecimals)}`
    : row ? yLabel(data, hover!.r) : '';
  const legendStops = color && !color.opacity
    ? Array.from({ length: 11 }, (_, i) => `${color.at(i / 10)} ${i * 10}%`).join(', ')
    : '';

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
        {showTooltip && hover && !drag && L && (
          <div
            className="absolute z-10 pointer-events-none rounded-md border bg-popover text-popover-foreground shadow-md px-2 py-1.5 text-[11px] space-y-0.5 whitespace-nowrap"
            style={{
              left: hover.mx + 12 + 200 > size.w ? undefined : hover.mx + 12,
              right: hover.mx + 12 + 200 > size.w ? size.w - hover.mx + 12 : undefined,
              top: Math.min(hover.my + 12, Math.max(0, size.h - 70)),
            }}
          >
            <div className="text-muted-foreground">{fmtTime(data.xs[hover.c] - data.step, span)} – {fmtTime(data.xs[hover.c], span)}</div>
            <div><span className="text-muted-foreground">{t('panel.heatmapBucket')}:</span> <span className="font-mono">{bucket}</span></div>
            <div><span className="text-muted-foreground">{t('panel.heatmapValue')}:</span> <span className="font-mono">{Number.isNaN(hv) ? '–' : cellText(hv)}</span></div>
          </div>
        )}
      </div>
      {showLegend && color && (
        <div className="shrink-0 h-4 mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono tabular-nums">{cellText(data.min)}</span>
          <div
            className="h-2 w-40 max-w-[50%] rounded-sm"
            style={{ background: color.opacity ? `linear-gradient(to right, transparent, ${color.at(1)})` : `linear-gradient(to right, ${legendStops})` }}
          />
          <span className="font-mono tabular-nums">{cellText(data.max)}</span>
        </div>
      )}
    </div>
  );
}
