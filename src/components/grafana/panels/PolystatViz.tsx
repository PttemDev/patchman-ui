import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrafanaFrame, GrafanaPanel } from '@/types';
import { cssColor, fieldDefaults, framesToValues, mapValue, reduce } from '../grafanaFrames';
import { formatValue } from '../grafanaUnits';

// grafana-polystat-panel (v1 Angular `panel.polystat` + `savedOverrides`, and
// v2 React `options`): one hexagon / square / circle per series, colored by
// the matching override's thresholds. Percona PMM's overview dashboards are
// built from these; a cell's click-through opens the linked dashboard.

type Opts = Record<string, unknown>;

interface Threshold { value: number; state: number; color?: string }
interface Override {
  match: string;
  operator?: string;
  thresholds: Threshold[];
  colors: string[];
  unit?: string;
  decimals?: number;
  prefix: string;
  suffix: string;
  clickThrough: string;
  alias: string;
}
interface Composite { name: string; members: string[]; clickThrough: string; hideMembers: boolean }
interface Config {
  shape: string;
  operator: string;
  unit: string;
  decimals?: number;
  fill: string;
  thresholds: Threshold[];
  colors: string[];
  triggeredOnly: boolean;
  emptyText: string;
  columns?: number;
  limit: number;
  sortField: string;
  sortDir: number;
  showValue: boolean;
  fontColor?: string;
  border: number;
  defaultClickThrough: string;
  overrides: Override[];
  composites: Composite[];
}

const OPERATORS: Record<string, string> = {
  avg: 'mean', mean: 'mean', current: 'lastNotNull', last: 'lastNotNull', lastNotNull: 'lastNotNull', min: 'min', max: 'max',
  total: 'sum', sum: 'sum', first: 'firstNotNull', delta: 'delta', diff: 'diff', range: 'range', count: 'count',
};
const DEFAULT_COLORS = ['#299c46', '#e5ac0e', '#bf1b00', '#ffffff'];

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function thresholds(v: unknown): Threshold[] {
  return arr<Opts>(v)
    .map((t) => ({ value: Number(t.value), state: Number(t.state ?? 0), color: typeof t.color === 'string' ? t.color : undefined }))
    .filter((t) => Number.isFinite(t.value))
    .sort((a, b) => a.value - b.value);
}

function readConfig(panel: GrafanaPanel): Config {
  const legacy = panel.polystat as Opts | undefined;
  if (legacy && !panel.options?.globalShape) {
    const colors = arr<string>(panel.colors).length ? arr<string>(panel.colors) : DEFAULT_COLORS;
    return {
      shape: String(legacy.shape ?? 'hexagon_pointed_top'),
      operator: String(legacy.globalOperatorName ?? 'avg'),
      unit: String(legacy.globalUnitFormat ?? 'short'),
      decimals: typeof legacy.globalDecimals === 'number' ? legacy.globalDecimals : undefined,
      fill: String(legacy.polygonGlobalFillColor ?? '#0a50a1'),
      thresholds: [],
      colors,
      triggeredOnly: legacy.globalDisplayMode === 'triggered',
      emptyText: String(legacy.globalDisplayTextTriggeredEmpty ?? 'OK'),
      columns: legacy.columnAutoSize === false && Number(legacy.columns) > 0 ? Number(legacy.columns) : undefined,
      limit: Number(legacy.displayLimit) > 0 ? Number(legacy.displayLimit) : 100,
      sortField: String(legacy.hexagonSortByField ?? 'name'),
      sortDir: Number(legacy.hexagonSortByDirection ?? 1),
      showValue: legacy.valueEnabled !== false,
      fontColor: legacy.fontAutoColor === false && typeof legacy.fontColor === 'string' ? legacy.fontColor : undefined,
      border: Number(legacy.polygonBorderSize ?? 2),
      defaultClickThrough: String(legacy.defaultClickThrough ?? ''),
      overrides: arr<Opts>(panel.savedOverrides).filter((o) => o.enabled !== false).map((o) => ({
        match: String(o.metricName ?? ''),
        operator: typeof o.operatorName === 'string' ? o.operatorName : undefined,
        thresholds: thresholds(o.thresholds),
        colors: arr<string>(o.colors).length ? arr<string>(o.colors) : colors,
        unit: typeof o.unitFormat === 'string' ? o.unitFormat : undefined,
        decimals: typeof o.decimals === 'number' ? o.decimals : (o.decimals != null && o.decimals !== '' ? Number(o.decimals) : undefined),
        prefix: String(o.prefix ?? ''),
        suffix: String(o.suffix ?? ''),
        clickThrough: String(o.clickThrough ?? ''),
        alias: String(o.alias ?? ''),
      })),
      composites: arr<Opts>(panel.savedComposites).filter((c) => c.enabled !== false).map((c) => ({
        name: String(c.compositeName ?? c.name ?? ''),
        members: arr<Opts>(c.members).map((m) => String(m.seriesName ?? m.seriesMatch ?? '')).filter(Boolean),
        clickThrough: String(c.clickThrough ?? ''),
        hideMembers: c.hideMembers !== false,
      })),
    };
  }
  const o = (panel.options ?? {}) as Opts;
  const composite = (o.compositeConfig ?? {}) as Opts;
  return {
    shape: String(o.globalShape ?? 'hexagon_pointed_top'),
    operator: String(o.globalOperator ?? 'mean'),
    unit: String(o.globalUnitFormat ?? 'short'),
    decimals: typeof o.globalDecimals === 'number' ? o.globalDecimals : undefined,
    fill: String(o.globalFillColor ?? '#0a50a1'),
    thresholds: thresholds(o.globalThresholdsConfig),
    colors: DEFAULT_COLORS,
    triggeredOnly: o.globalDisplayMode === 'triggered',
    emptyText: String(o.globalDisplayTextTriggeredEmpty ?? 'OK'),
    columns: o.autoSizeColumns === false && Number(o.layoutNumColumns) > 0 ? Number(o.layoutNumColumns) : undefined,
    limit: Number(o.layoutDisplayLimit) > 0 ? Number(o.layoutDisplayLimit) : 100,
    sortField: String(o.sortByField ?? 'name'),
    sortDir: Number(o.sortByDirection ?? 1),
    showValue: o.globalShowValueEnabled !== false,
    fontColor: o.globalTextFontAutoColorEnabled === false && typeof o.globalTextFontColor === 'string' ? o.globalTextFontColor : undefined,
    border: Number(o.globalPolygonBorderSize ?? 2),
    defaultClickThrough: String(o.globalClickthrough ?? ''),
    overrides: arr<Opts>((o.overrideConfig as Opts | undefined)?.overrides).filter((x) => x.enabled !== false).map((x) => ({
      match: String(x.metricName ?? ''),
      operator: typeof x.operatorName === 'string' ? x.operatorName : undefined,
      thresholds: thresholds(x.thresholds),
      colors: arr<string>(x.colors).length ? arr<string>(x.colors) : DEFAULT_COLORS,
      unit: typeof x.unitFormat === 'string' ? x.unitFormat : undefined,
      decimals: typeof x.decimals === 'number' ? x.decimals : undefined,
      prefix: String(x.prefix ?? ''),
      suffix: String(x.suffix ?? ''),
      clickThrough: String(x.clickThrough ?? ''),
      alias: String(x.alias ?? ''),
    })),
    composites: composite.enabled === false ? [] : arr<Opts>(composite.composites).filter((c) => c.showComposite !== false).map((c) => ({
      name: String(c.name ?? ''),
      members: arr<Opts>(c.metrics).map((m) => String(m.seriesMatch ?? '')).filter(Boolean),
      clickThrough: String(c.clickThrough ?? ''),
      hideMembers: c.showMembers !== true,
    })),
  };
}

/** Polystat metric matcher: "/regex/flags" or an exact name. */
function matches(pattern: string, name: string): boolean {
  if (!pattern) return false;
  const m = /^\/(.*)\/([gimsuy]*)$/s.exec(pattern);
  if (m) {
    try { return new RegExp(m[1], m[2].replace('g', '')).test(name); } catch { return false; }
  }
  return pattern === name;
}

interface Cell {
  name: string;
  value: number | null;
  text: string;
  color: string;
  state: number;
  link: string;
  members?: Array<{ name: string; text: string; state: number }>;
}

function stateOf(value: number | null, ths: Threshold[], colors: string[], fallback: string): { state: number; color: string } {
  if (ths.length === 0 || value === null) return { state: value === null ? 3 : -1, color: value === null && ths.length ? (colors[3] ?? fallback) : fallback };
  let t = ths[0];
  for (const x of ths) if (value >= x.value) t = x;
  return { state: t.state, color: t.color ?? colors[t.state] ?? fallback };
}

function buildCells(panel: GrafanaPanel, frames: GrafanaFrame[], cfg: Config): Cell[] {
  const d = fieldDefaults(panel);
  const series = framesToValues(frames, panel);
  const legacyMaps = arr<Opts>(panel.valueMaps);
  const singles: Cell[] = series.map((s) => {
    const ov = cfg.overrides.find((o) => matches(o.match, s.name));
    const calc = OPERATORS[ov?.operator ?? cfg.operator] ?? 'mean';
    const value = reduce(s.points, calc);
    const { state, color } = stateOf(value, ov?.thresholds.length ? ov.thresholds : cfg.thresholds, ov?.colors ?? cfg.colors, cfg.fill);
    let text: string | undefined;
    const mapped = mapValue(value, d);
    if (mapped?.text) text = mapped.text;
    if (!text && value === null) text = String(legacyMaps.find((m) => m.value === 'null')?.text ?? 'N/A');
    if (!text) text = `${ov?.prefix ?? ''}${formatValue(value, ov?.unit ?? cfg.unit, ov?.decimals ?? cfg.decimals)}${ov?.suffix ?? ''}`;
    return {
      name: ov?.alias || s.name,
      value,
      text,
      color: cssColor(mapped?.color) ?? cssColor(color) ?? color,
      state,
      link: ov?.clickThrough || cfg.defaultClickThrough,
    };
  });
  // Composites: one cell per group showing its worst member.
  const hidden = new Set<string>();
  const comps: Cell[] = [];
  for (const c of cfg.composites) {
    const members = singles.filter((s) => c.members.some((m) => matches(m, s.name) || m === s.name));
    if (members.length === 0) continue;
    const worst = [...members].sort((a, b) => b.state - a.state)[0];
    if (c.hideMembers) members.forEach((m) => hidden.add(m.name));
    comps.push({
      ...worst,
      name: c.name || worst.name,
      link: c.clickThrough || worst.link,
      members: members.map((m) => ({ name: m.name, text: m.text, state: m.state })),
    });
  }
  let cells = [...comps, ...singles.filter((s) => !hidden.has(s.name))];
  if (cfg.triggeredOnly) cells = cells.filter((c) => c.state >= 1);
  if (cfg.sortDir === 1 || cfg.sortDir === 2) {
    const dir = cfg.sortDir === 2 ? -1 : 1;
    cells.sort((a, b) => dir * (cfg.sortField === 'value'
      ? (a.value ?? -Infinity) - (b.value ?? -Infinity)
      : a.name.localeCompare(b.name, undefined, { numeric: true })));
  }
  return cells.slice(0, cfg.limit);
}

// ── layout ──────────────────────────────────────────────────────────

const SQRT3 = Math.sqrt(3);

function layout(n: number, W: number, H: number, shape: string, fixedCols?: number) {
  let best = { cols: 1, rows: n, r: 0 };
  for (let cols = 1; cols <= n; cols++) {
    if (fixedCols && cols !== Math.min(fixedCols, n)) continue;
    const rows = Math.ceil(n / cols);
    let r: number;
    if (shape === 'hexagon_flat_top') r = Math.min(W / (2 + (cols - 1) * 1.5), H / (SQRT3 * (rows + (cols > 1 ? 0.5 : 0))));
    else if (shape === 'square' || shape === 'circle') r = Math.min(W / (2 * cols), H / (2 * rows));
    else r = Math.min(W / (SQRT3 * (cols + (rows > 1 ? 0.5 : 0))), H / (2 + (rows - 1) * 1.5));
    if (r > best.r) best = { cols, rows, r };
  }
  const { cols, rows, r } = best;
  let w: number;
  let h: number;
  if (shape === 'hexagon_flat_top') { w = r * (2 + (cols - 1) * 1.5); h = SQRT3 * r * (rows + (cols > 1 ? 0.5 : 0)); }
  else if (shape === 'square' || shape === 'circle') { w = 2 * r * cols; h = 2 * r * rows; }
  else { w = SQRT3 * r * (cols + (rows > 1 ? 0.5 : 0)); h = r * (2 + (rows - 1) * 1.5); }
  const ox = (W - w) / 2;
  const oy = (H - h) / 2;
  const centers = Array.from({ length: n }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (shape === 'hexagon_flat_top') return { x: ox + r + col * 1.5 * r, y: oy + SQRT3 * r * (row + 0.5 + (col % 2 ? 0.5 : 0)) };
    if (shape === 'square' || shape === 'circle') return { x: ox + r * (2 * col + 1), y: oy + r * (2 * row + 1) };
    return { x: ox + SQRT3 * r * (col + 0.5 + (row % 2 ? 0.5 : 0)), y: oy + r + row * 1.5 * r };
  });
  return { r, centers };
}

function hexPath(x: number, y: number, r: number, flat: boolean): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - (flat ? 0 : 30));
    pts.push(`${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

function luminance(color: string): number {
  let r = 0, g = 0, b = 0;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  const rgb = /^rgba?\(([^)]+)\)/i.exec(color);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else if (rgb) {
    [r, g, b] = rgb[1].split(',').map((x) => parseFloat(x));
  } else {
    return 0.3;
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ellipsize(text: string, px: number, maxW: number): string {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text;
  measureCtx.font = `600 ${px}px ui-sans-serif, system-ui, sans-serif`;
  if (measureCtx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureCtx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

export function PolystatViz({ panel, frames, onLink }: {
  panel: GrafanaPanel;
  frames: GrafanaFrame[];
  onLink?: (url: string) => void;
}) {
  const { t } = useTranslation('grafana');
  const cfg = useMemo(() => readConfig(panel), [panel]);
  const cells = useMemo(() => buildCells(panel, frames, cfg), [panel, frames, cfg]);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const hasSeries = framesToValues(frames, panel).length > 0;
  if (!hasSeries) return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t('panel.noData')}</div>;
  if (cells.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm font-medium text-emerald-600 dark:text-emerald-400">{cfg.emptyText}</div>;
  }

  const { r, centers } = size.w > 0 ? layout(cells.length, size.w, size.h, cfg.shape, cfg.columns) : { r: 0, centers: [] };
  const inner = Math.max(1, r - Math.max(0.5, cfg.border));
  const flat = cfg.shape === 'hexagon_flat_top';
  const textW = cfg.shape === 'square' ? inner * 1.8 : inner * 1.45;
  const nameSize = Math.max(7, Math.min(16, r * 0.24));
  const valueSize = Math.max(8, Math.min(22, r * 0.32));
  const showText = r >= 14;

  const resolveLink = (c: Cell) => {
    if (!c.link) return '';
    // $__from / $__to and dashboard variables are filled by the opener.
    return c.link
      .replace(/\$\{__cell_name\}|\$__cell_name/g, encodeURIComponent(c.name.trim()))
      .replace(/\$\{__cell\}|\$__cell\b/g, encodeURIComponent(c.text))
      .replace(/\$\{__cell_raw\}|\$__cell_raw/g, encodeURIComponent(String(c.value ?? '')));
  };

  const hv = hover ? cells[hover.i] : null;
  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden select-none">
      {size.w > 0 && (
        <svg width={size.w} height={size.h} className="block">
          {cells.map((c, i) => {
            const { x, y } = centers[i];
            const fg = cfg.fontColor ?? (luminance(c.color) > 0.6 ? '#111' : '#fff');
            const link = resolveLink(c);
            return (
              <g
                key={`${c.name}-${i}`}
                onMouseMove={(e) => {
                  const rect = ref.current!.getBoundingClientRect();
                  setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => { if (link && onLink) onLink(link); }}
                style={{ cursor: link && onLink ? 'pointer' : 'default' }}
              >
                {cfg.shape === 'circle' ? (
                  <circle cx={x} cy={y} r={inner} fill={c.color} />
                ) : cfg.shape === 'square' ? (
                  <rect x={x - inner} y={y - inner} width={inner * 2} height={inner * 2} rx={2} fill={c.color} />
                ) : (
                  <path d={hexPath(x, y, inner, flat)} fill={c.color} />
                )}
                {showText && (
                  <text x={x} textAnchor="middle" fill={fg} style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontWeight: 600 }}>
                    <tspan x={x} y={cfg.showValue ? y - valueSize * 0.25 : y + nameSize * 0.35} fontSize={nameSize}>{ellipsize(c.name.trim(), nameSize, textW)}</tspan>
                    {cfg.showValue && <tspan x={x} y={y + valueSize * 0.95} fontSize={valueSize}>{ellipsize(c.text, valueSize, textW)}</tspan>}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hv && hover && (
        <div
          className="absolute z-10 pointer-events-none rounded-md border bg-popover text-popover-foreground shadow-md px-2 py-1.5 text-[11px] space-y-0.5 max-w-[280px]"
          style={{
            left: hover.x + 12 + 220 > size.w ? undefined : hover.x + 12,
            right: hover.x + 12 + 220 > size.w ? size.w - hover.x + 12 : undefined,
            top: Math.min(hover.y + 12, Math.max(0, size.h - 60)),
          }}
        >
          <div className="flex items-center gap-1.5 font-medium">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: hv.color }} />
            <span className="break-all">{hv.name.trim()}</span>
          </div>
          {hv.members ? hv.members.map((m) => (
            <div key={m.name} className="flex justify-between gap-3"><span className="truncate text-muted-foreground">{m.name.trim()}</span><span className="font-mono">{m.text}</span></div>
          )) : <div className="font-mono">{hv.text}</div>}
        </div>
      )}
    </div>
  );
}
