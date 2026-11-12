import type { GrafanaFrame, GrafanaPanel } from '@/types';
import { cssColor, framesToSeries, type Series } from './grafanaFrames';

// Heatmap data: Grafana frames → a column (time) × row (bucket) count grid.
// Three input shapes, as in Grafana's heatmap panel:
//  - buckets: one series per bucket — Prometheus `le` (cumulative, made
//    per-bucket when the target asks for format "heatmap"), VictoriaMetrics
//    `vmrange`, numeric field names (heatmap-rows) or plain series (ordinal);
//  - calculate: raw values bucketed here (options.calculate / legacy
//    dataFormat "timeseries");
//  - heatmap-cells frames (xMin/xMax, yMin/yMax, count).

export interface HeatmapRow {
  label: string;
  lo: number | null;
  hi: number | null;
  /** Value printed on the y axis (bucket bound) for numeric rows. */
  value: number | null;
}

export interface Heatmap {
  /** Column END times (ms); a cell spans [x - step, x]. */
  xs: number[];
  step: number;
  /** Bottom → top. */
  rows: HeatmapRow[];
  /** cells[col * rows.length + row]; NaN = no value. */
  cells: Float64Array;
  min: number;
  max: number;
  /** Rows are numeric ranges (vs ordinal series names). */
  numeric: boolean;
  /** Cells at or below this are not drawn (options.filterValues.le). */
  hideLe: number;
  /** No drawable cell. */
  empty: boolean;
}

type Opts = Record<string, unknown>;

function get<T>(o: unknown, path: string): T | undefined {
  let cur: unknown = o;
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Opts)) cur = (cur as Opts)[p];
    else return undefined;
  }
  return cur as T;
}

export function isLegacyHeatmap(panel: GrafanaPanel): boolean {
  return get(panel, 'options.calculate') === undefined && (panel.dataFormat !== undefined || panel.cards !== undefined);
}

function parseBound(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (/^\+?inf$/i.test(t)) return Infinity;
  if (/^-inf$/i.test(t)) return -Infinity;
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function boundOf(s: Series): { lo: number | null; hi: number | null; le: boolean } | null {
  const le = s.labels?.le;
  if (le !== undefined) {
    const hi = parseBound(le);
    return hi === null ? null : { lo: null, hi, le: true };
  }
  const vm = s.labels?.vmrange;
  if (vm && vm.includes('...')) {
    const [a, b] = vm.split('...');
    const lo = parseBound(a);
    const hi = parseBound(b);
    return lo === null && hi === null ? null : { lo, hi, le: false };
  }
  const n = parseBound(s.name);
  return n === null ? null : { lo: null, hi: n, le: true };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Time columns covering every timestamp: a regular grid with the median
 *  spacing (capped so a misaligned SQL result can't explode the grid). */
function columns(times: number[]): { xs: number[]; step: number; colOf: (t: number) => number } {
  const uniq = [...new Set(times)].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < uniq.length; i++) diffs.push(uniq[i] - uniq[i - 1]);
  let step = median(diffs.filter((d) => d > 0)) || 60_000;
  const first = uniq[0];
  const last = uniq[uniq.length - 1];
  while ((last - first) / step > 3000) step *= 2;
  const n = Math.round((last - first) / step) + 1;
  const xs = Array.from({ length: n }, (_, i) => first + i * step);
  return { xs, step, colOf: (t) => Math.min(n - 1, Math.max(0, Math.round((t - first) / step))) };
}

function finish(xs: number[], step: number, rows: HeatmapRow[], cells: Float64Array, numeric: boolean, hideLe: number): Heatmap {
  let min = Infinity;
  let max = -Infinity;
  for (const v of cells) {
    if (!(v > hideLe)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const empty = min === Infinity;
  if (empty) { min = 0; max = 0; }
  return { xs, step, rows, cells, min, max, numeric, hideLe, empty };
}

function bucketHeatmap(series: Series[], panel: GrafanaPanel, hideLe: number): Heatmap {
  const bounds = series.map(boundOf);
  const numeric = bounds.every((b) => b !== null);
  // Merge series that land on the same bucket (e.g. `by (le, instance)`).
  const groups = new Map<string, { row: HeatmapRow; le: boolean; members: Series[]; order: number }>();
  series.forEach((s, i) => {
    const b = bounds[i];
    const key = numeric && b ? `${b.lo}|${b.hi}` : s.name;
    let g = groups.get(key);
    if (!g) {
      g = { row: { label: s.name, lo: b?.lo ?? null, hi: b?.hi ?? null, value: b ? (b.hi ?? b.lo) : null }, le: Boolean(b?.le), members: [], order: i };
      groups.set(key, g);
    }
    g.members.push(s);
  });
  const list = [...groups.values()];
  if (numeric) list.sort((a, b) => (a.row.hi ?? a.row.lo ?? 0) - (b.row.hi ?? b.row.lo ?? 0));
  else list.sort((a, b) => a.order - b.order);
  // `le` rows span (previous bound, le].
  if (numeric) list.forEach((g, i) => { if (g.le && g.row.lo === null && i > 0) g.row.lo = list[i - 1].row.hi; });

  const { xs, step, colOf } = columns(series.flatMap((s) => s.points.map((p) => p.t)));
  const R = list.length;
  const cells = new Float64Array(xs.length * R).fill(NaN);
  list.forEach((g, r) => {
    for (const s of g.members) {
      for (const p of s.points) {
        if (p.v === null) continue;
        const i = colOf(p.t) * R + r;
        cells[i] = Number.isNaN(cells[i]) ? p.v : cells[i] + p.v;
      }
    }
  });
  // Prometheus histogram buckets are cumulative; Grafana subtracts the
  // bucket below when the query is formatted as "heatmap".
  const cumulative = numeric && list.every((g) => g.le) &&
    (panel.targets ?? []).some((t) => (t as Opts).format === 'heatmap');
  if (cumulative) {
    for (let c = 0; c < xs.length; c++) {
      for (let r = R - 1; r > 0; r--) {
        const i = c * R + r;
        const below = cells[i - 1];
        if (!Number.isNaN(cells[i]) && !Number.isNaN(below)) cells[i] = Math.max(0, cells[i] - below);
      }
    }
  }
  return finish(xs, step, list.map((g) => g.row), cells, numeric, hideLe);
}

function calculateHeatmap(series: Series[], panel: GrafanaPanel, legacy: boolean, hideLe: number): Heatmap | null {
  const values: number[] = [];
  for (const s of series) for (const p of s.points) if (p.v !== null && Number.isFinite(p.v)) values.push(p.v);
  if (values.length === 0) return null;
  const yb = (legacy ? {} : get<Opts>(panel, 'options.calculation.yBuckets') ?? {}) as Opts;
  const scaleType = legacy ? (Number(get(panel, 'yAxis.logBase') ?? 1) > 1 ? 'log' : 'linear') : (get<string>(yb, 'scale.type') ?? 'linear');
  const logBase = legacy ? Number(get(panel, 'yAxis.logBase') ?? 2) : Number(get(yb, 'scale.log') ?? 2);
  const mode = legacy ? (panel.yBucketSize ? 'size' : 'count') : ((yb.mode as string) ?? 'count');
  const value = Number(legacy ? (panel.yBucketSize ?? panel.yBucketNumber) : yb.value) || 0;

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const rows: HeatmapRow[] = [];
  if (scaleType === 'log') {
    const pos = values.filter((v) => v > 0);
    if (pos.length === 0) return null;
    lo = Math.min(...pos);
    hi = Math.max(...pos);
    const base = logBase > 1 ? logBase : 2;
    const split = mode === 'count' && value > 0 ? Math.max(1, Math.round(value)) : 1;
    const k0 = Math.floor(Math.log(lo) / Math.log(base) * split);
    const k1 = Math.ceil(Math.log(hi) / Math.log(base) * split + 1e-9);
    for (let k = k0; k < Math.max(k1, k0 + 1); k++) {
      const a = base ** (k / split);
      const b = base ** ((k + 1) / split);
      rows.push({ label: String(a), lo: a, hi: b, value: a });
    }
  } else {
    let size = mode === 'size' && value > 0 ? value : 0;
    if (!size) {
      const count = mode === 'count' && value > 0 ? value : 20;
      size = (hi - lo) / count || 1;
    }
    const start = Math.floor(lo / size) * size;
    const n = Math.min(500, Math.max(1, Math.ceil((hi - start) / size + 1e-9)));
    for (let k = 0; k < n; k++) rows.push({ label: String(start + k * size), lo: start + k * size, hi: start + (k + 1) * size, value: start + k * size });
  }
  const rowOf = (v: number) => {
    let a = 0;
    let b = rows.length - 1;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if ((rows[m].lo ?? -Infinity) <= v) a = m;
      else b = m - 1;
    }
    return a;
  };
  const { xs, step, colOf } = columns(series.flatMap((s) => s.points.map((p) => p.t)));
  const R = rows.length;
  const cells = new Float64Array(xs.length * R).fill(NaN);
  for (const s of series) {
    for (const p of s.points) {
      if (p.v === null || !Number.isFinite(p.v) || (scaleType === 'log' && p.v <= 0)) continue;
      const i = colOf(p.t) * R + rowOf(p.v);
      cells[i] = Number.isNaN(cells[i]) ? 1 : cells[i] + 1;
    }
  }
  return finish(xs, step, rows, cells, true, hideLe);
}

/** Frames already shaped as cells (Prometheus native histograms etc.). */
function cellsHeatmap(frames: GrafanaFrame[], hideLe: number): Heatmap | null {
  const frame = frames.find((f) => (f.schema.meta as Opts | undefined)?.type === 'heatmap-cells');
  if (!frame) return null;
  const idx = (n: string) => frame.schema.fields.findIndex((f) => f.name === n);
  const xi = idx('xMax') >= 0 ? idx('xMax') : idx('xMin');
  const yi = idx('yMin');
  const yx = idx('yMax');
  const ci = idx('count') >= 0 ? idx('count') : frame.schema.fields.findIndex((f, i) => f.type === 'number' && i !== yi && i !== yx);
  if (xi < 0 || yi < 0 || ci < 0) return null;
  const X = frame.data.values[xi] as number[];
  const Y = frame.data.values[yi] as number[];
  const YX = yx >= 0 ? (frame.data.values[yx] as number[]) : null;
  const C = frame.data.values[ci] as Array<number | null>;
  const ys = [...new Set(Y)].sort((a, b) => a - b);
  const rows: HeatmapRow[] = ys.map((y, i) => {
    const hiAt = YX ? YX[Y.indexOf(y)] : ys[i + 1];
    return { label: String(y), lo: y, hi: hiAt ?? null, value: y };
  });
  const rowOf = new Map(ys.map((y, i) => [y, i]));
  const { xs, step, colOf } = columns(X.map(Number));
  const cells = new Float64Array(xs.length * rows.length).fill(NaN);
  for (let k = 0; k < X.length; k++) {
    const v = C[k];
    if (v === null || v === undefined) continue;
    cells[colOf(Number(X[k])) * rows.length + rowOf.get(Y[k])!] = Number(v);
  }
  return finish(xs, step, rows, cells, true, hideLe);
}

export function buildHeatmap(frames: GrafanaFrame[], panel: GrafanaPanel): Heatmap | null {
  const legacy = isLegacyHeatmap(panel);
  const hideLe = legacy ? (panel.hideZeroBuckets ? 0 : -Infinity) : Number(get(panel, 'options.filterValues.le') ?? 1e-9);
  const cellFrames = cellsHeatmap(frames, hideLe);
  if (cellFrames) return cellFrames;
  const series = framesToSeries(frames, panel).filter((s) => s.points.length > 0);
  if (series.length === 0) return null;
  const calculate = legacy ? (panel.dataFormat ?? 'timeseries') === 'timeseries' : get(panel, 'options.calculate') === true;
  return calculate ? calculateHeatmap(series, panel, legacy, hideLe) : bucketHeatmap(series, panel, hideLe);
}

// ── colors ──────────────────────────────────────────────────────────

// d3-scale-chromatic stops (light → dark for the sequential ones).
const SCHEMES: Record<string, { stops: string[]; invert: 'dark' | 'always' | 'never' }> = {
  Oranges: { stops: ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'], invert: 'dark' },
  Blues: { stops: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'], invert: 'dark' },
  Greens: { stops: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'], invert: 'dark' },
  Reds: { stops: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'], invert: 'dark' },
  Purples: { stops: ['#fcfbfd', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'], invert: 'dark' },
  Greys: { stops: ['#ffffff', '#d9d9d9', '#969696', '#525252', '#000000'], invert: 'dark' },
  YlOrRd: { stops: ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'], invert: 'dark' },
  YlOrBr: { stops: ['#ffffe5', '#fee391', '#fe9929', '#cc4c02', '#662506'], invert: 'dark' },
  YlGnBu: { stops: ['#ffffd9', '#c7e9b4', '#41b6c4', '#225ea8', '#081d58'], invert: 'dark' },
  YlGn: { stops: ['#ffffe5', '#d9f0a3', '#78c679', '#238443', '#004529'], invert: 'dark' },
  RdPu: { stops: ['#fff7f3', '#fcc5c0', '#f768a1', '#ae017e', '#49006a'], invert: 'dark' },
  BuPu: { stops: ['#f7fcfd', '#bfd3e6', '#8c96c6', '#88419d', '#4d004b'], invert: 'dark' },
  BuGn: { stops: ['#f7fcfd', '#ccece6', '#66c2a4', '#238b45', '#00441b'], invert: 'dark' },
  GnBu: { stops: ['#f7fcf0', '#ccebc5', '#7bccc4', '#2b8cbe', '#084081'], invert: 'dark' },
  OrRd: { stops: ['#fff7ec', '#fdd49e', '#fc8d59', '#d7301f', '#7f0000'], invert: 'dark' },
  PuBu: { stops: ['#fff7fb', '#d0d1e6', '#74a9cf', '#0570b0', '#023858'], invert: 'dark' },
  PuRd: { stops: ['#f7f4f9', '#d4b9da', '#df65b0', '#ce1256', '#67001f'], invert: 'dark' },
  Spectral: { stops: ['#9e0142', '#f46d43', '#fee08b', '#e6f598', '#66c2a5', '#5e4fa2'], invert: 'always' },
  RdYlGn: { stops: ['#a50026', '#f46d43', '#fee08b', '#d9ef8b', '#66bd63', '#006837'], invert: 'always' },
  RdYlBu: { stops: ['#a50026', '#f46d43', '#fee090', '#e0f3f8', '#74add1', '#313695'], invert: 'always' },
  RdBu: { stops: ['#67001f', '#d6604d', '#fddbc7', '#d1e5f0', '#4393c3', '#053061'], invert: 'always' },
  Viridis: { stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'], invert: 'never' },
  Magma: { stops: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'], invert: 'never' },
  Inferno: { stops: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'], invert: 'never' },
  Plasma: { stops: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'], invert: 'never' },
  Cividis: { stops: ['#00224e', '#434e6c', '#7d7c78', '#bcaf6f', '#fee838'], invert: 'never' },
  Turbo: { stops: ['#30123b', '#4686fb', '#1ae4b6', '#a2fc3c', '#fabb39', '#e3440a', '#7a0403'], invert: 'never' },
};

function hexRGB(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function interpolate(stops: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexRGB(stops[i]);
  const b = hexRGB(stops[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export interface HeatmapColor {
  /** Color for a normalised value in [0, 1]. */
  at: (t: number) => string;
  /** Opacity mode: one color, alpha = value. */
  opacity: boolean;
  /** Value → [0, 1] (exponential / linear scale, color min/max). */
  norm: (v: number) => number;
}

export function heatmapColor(panel: GrafanaPanel, data: Heatmap, dark: boolean, fallbackFill: string): HeatmapColor {
  const legacy = isLegacyHeatmap(panel);
  const c = ((legacy ? panel.color : get(panel, 'options.color')) ?? {}) as Opts;
  const opacity = c.mode === 'opacity';
  const schemeName = String((legacy ? String(c.colorScheme ?? 'interpolateOranges').replace(/^interpolate/, '') : c.scheme) ?? 'Oranges');
  const scheme = SCHEMES[schemeName] ?? SCHEMES.Oranges;
  const exponential = legacy ? c.colorScale !== 'linear' : c.scale !== 'linear';
  const exponent = Number(c.exponent ?? 0.5) || 0.5;
  const min = typeof c.min === 'number' ? c.min : data.min;
  const max = typeof c.max === 'number' ? c.max : data.max;
  const steps = Math.max(2, Number(c.steps ?? 64) || 64);
  let flip = scheme.invert === 'always' || (scheme.invert === 'dark' && dark);
  if (!legacy && c.reverse === true) flip = !flip;
  const norm = (v: number) => {
    let t = max > min ? (v - min) / (max - min) : 1;
    t = Math.min(1, Math.max(0, t));
    if (exponential) t = t ** exponent;
    return Math.round(t * (steps - 1)) / (steps - 1);
  };
  if (opacity) {
    const fill = cssColor((legacy ? c.cardColor : c.fill) ?? 'dark-orange') ?? fallbackFill;
    return { at: () => fill, opacity: true, norm };
  }
  return { at: (t) => interpolate(scheme.stops, flip ? 1 - t : t), opacity: false, norm };
}
