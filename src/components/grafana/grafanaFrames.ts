import type { GrafanaFrame, GrafanaPanel } from '@/types';

// Data-frame helpers: Grafana's JSON frames → what the native panels draw.
// Covers wide frames (time + N number fields), long frames (time + label
// strings + values, typical for SQL/Loki metrics) which are pivoted to wide,
// tables and log frames.

export interface SeriesPoint {
  t: number;
  v: number | null;
}

export interface Series {
  key: string;
  name: string;
  labels?: Record<string, string>;
  points: SeriesPoint[];
  color?: string;
  unit?: string;
  decimals?: number;
}

// Grafana's classic palette — what panels without explicit colors use.
export const PALETTE = [
  '#7EB26D', '#EAB839', '#6ED0E0', '#EF843C', '#E24D42', '#1F78C1', '#BA43A6', '#705DA0',
  '#508642', '#CCA300', '#447EBC', '#C15C17', '#890F02', '#0A437C', '#6D1F62', '#584477',
];

const NAMED: Record<string, string> = {
  green: '#73BF69', red: '#F2495C', orange: '#FF9830', yellow: '#FADE2A', blue: '#5794F2', purple: '#B877D9',
  'dark-green': '#37872D', 'dark-red': '#C4162A', 'dark-orange': '#FA6400', 'dark-yellow': '#E0B400',
  'dark-blue': '#1F60C4', 'dark-purple': '#8F3BB8', 'semi-dark-green': '#56A64B', 'semi-dark-red': '#E02F44',
  'semi-dark-orange': '#FF780A', 'semi-dark-yellow': '#F2CC0C', 'semi-dark-blue': '#3274D9',
  'semi-dark-purple': '#A352CC', 'light-green': '#96D98D', 'light-red': '#FF7383', 'light-orange': '#FFB357',
  'light-yellow': '#FFEE52', 'light-blue': '#8AB8FF', 'light-purple': '#CA95E5', 'super-light-green': '#C8F2C2',
  'super-light-red': '#FFA6B0', 'super-light-orange': '#FFCB7D', 'super-light-yellow': '#FFF899',
  'super-light-blue': '#C0D8FF', 'super-light-purple': '#DEB6F2', text: 'var(--color-foreground)',
  transparent: 'transparent',
};

export function cssColor(c: unknown): string | undefined {
  if (typeof c !== 'string' || !c) return undefined;
  return NAMED[c] ?? c;
}

/** Field config defaults with the bits panels read. */
export interface FieldDefaults {
  unit?: string;
  decimals?: number;
  min?: number;
  max?: number;
  displayName?: string;
  thresholds?: { mode?: string; steps?: Array<{ color: string; value: number | null }> };
  color?: { mode?: string; fixedColor?: string };
  noValue?: string;
  mappings?: Array<Record<string, unknown>>;
}

export function fieldDefaults(panel: GrafanaPanel): FieldDefaults {
  const d = (panel.fieldConfig?.defaults ?? {}) as FieldDefaults & Record<string, unknown>;
  return d;
}

/** Override properties for a series name (byName / byRegexp / byFrameRefID matchers). */
export function overrideProps(panel: GrafanaPanel, name: string, refId?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of panel.fieldConfig?.overrides ?? []) {
    const m = (o.matcher ?? {}) as { id?: string; options?: unknown };
    let hit = false;
    if (m.id === 'byName' || m.id === 'byDisplayName') hit = m.options === name;
    else if (m.id === 'byRegexp' && typeof m.options === 'string') {
      try { hit = new RegExp(m.options).test(name); } catch { hit = false; }
    } else if (m.id === 'byFrameRefID') hit = m.options === refId;
    if (!hit) continue;
    for (const p of (o.properties ?? []) as Array<{ id: string; value: unknown }>) {
      if (p.id === 'displayName') out.displayName = p.value;
      if (p.id === 'color') out.color = p.value;
      if (p.id === 'unit') out.unit = p.value;
      if (p.id === 'decimals') out.decimals = p.value;
    }
  }
  return out;
}

/** Applies `entities` (NaN / Inf markers) and returns plain values. */
function fieldValues(frame: GrafanaFrame, i: number): unknown[] {
  const vals = [...(frame.data.values[i] ?? [])];
  const ent = frame.data.entities?.[i];
  if (ent) {
    for (const idxs of Object.values(ent)) for (const k of idxs ?? []) vals[k] = null;
  }
  return vals;
}

function labelName(labels?: Record<string, string>): string {
  if (!labels) return '';
  const entries = Object.entries(labels);
  if (entries.length === 1) return entries[0][1];
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(', ')}}`;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toTime(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(v);
    return Number.isNaN(d) ? null : d;
  }
  return null;
}

/** Long frame (time + string label columns + number columns, repeated
 *  timestamps) → one wide frame per label combination. */
export function longToWide(frame: GrafanaFrame): GrafanaFrame[] {
  const fields = frame.schema.fields;
  const timeIdx = fields.findIndex((f) => f.type === 'time');
  const strIdx = fields.map((f, i) => (f.type === 'string' ? i : -1)).filter((i) => i >= 0);
  const numIdx = fields.map((f, i) => (f.type === 'number' ? i : -1)).filter((i) => i >= 0);
  if (timeIdx < 0 || strIdx.length === 0 || numIdx.length === 0) return [frame];
  const groups = new Map<string, { labels: Record<string, string>; rows: number[] }>();
  const n = frame.data.values[timeIdx]?.length ?? 0;
  for (let r = 0; r < n; r++) {
    const labels: Record<string, string> = {};
    for (const i of strIdx) labels[fields[i].name] = String(frame.data.values[i]?.[r] ?? '');
    const key = JSON.stringify(labels);
    if (!groups.has(key)) groups.set(key, { labels, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const out: GrafanaFrame[] = [];
  for (const g of groups.values()) {
    const times = g.rows.map((r) => frame.data.values[timeIdx][r]);
    const values: unknown[][] = [times];
    const outFields: GrafanaFrame['schema']['fields'] = [fields[timeIdx]];
    for (const i of numIdx) {
      values.push(g.rows.map((r) => frame.data.values[i][r]));
      outFields.push({ ...fields[i], labels: { ...(fields[i].labels ?? {}), ...g.labels } });
    }
    out.push({ schema: { ...frame.schema, fields: outFields }, data: { values } });
  }
  return out;
}

function isLong(frame: GrafanaFrame): boolean {
  const f = frame.schema.fields;
  if (!f.some((x) => x.type === 'string') || !f.some((x) => x.type === 'number')) return false;
  const timeIdx = f.findIndex((x) => x.type === 'time');
  if (timeIdx < 0) return false;
  const times = frame.data.values[timeIdx] ?? [];
  return new Set(times).size < times.length; // repeated timestamps
}

/** All time series in the result frames. */
export function framesToSeries(frames: GrafanaFrame[], panel?: GrafanaPanel): Series[] {
  const defaults = panel ? fieldDefaults(panel) : {};
  const out: Series[] = [];
  const expanded = frames.flatMap((f) => (isLong(f) ? longToWide(f) : [f]));
  const multi = expanded.length > 1;
  for (const frame of expanded) {
    const fields = frame.schema.fields;
    const timeIdx = fields.findIndex((f) => f.type === 'time');
    if (timeIdx < 0) continue;
    const times = fieldValues(frame, timeIdx).map(toTime);
    fields.forEach((field, i) => {
      if (i === timeIdx || field.type !== 'number') return;
      const vals = fieldValues(frame, i);
      const cfg = (field.config ?? {}) as Record<string, unknown>;
      let name = (cfg.displayNameFromDS as string) || (cfg.displayName as string) || '';
      if (!name) {
        const ln = labelName(field.labels);
        if (ln) name = field.name && !/^value$/i.test(field.name) && fields.filter((f) => f.type === 'number').length > 1 ? `${field.name} ${ln}` : ln;
        else if (multi && frame.schema.name) name = frame.schema.name;
        else name = field.name || frame.schema.name || 'Value';
      }
      if (defaults.displayName && !multi && fields.filter((f) => f.type === 'number').length === 1) {
        name = defaults.displayName.replace(/\$\{__field\.labels\.(\w+)\}/g, (_, k) => field.labels?.[k] ?? '');
      }
      const ov = panel ? overrideProps(panel, name, frame.schema.refId) : {};
      const points: SeriesPoint[] = [];
      for (let r = 0; r < times.length; r++) {
        const t = times[r];
        if (t === null) continue;
        points.push({ t, v: toNumber(vals[r]) });
      }
      points.sort((a, b) => a.t - b.t);
      const color = (ov.color as { fixedColor?: string } | undefined)?.fixedColor;
      out.push({
        key: `${frame.schema.refId ?? ''}:${out.length}:${name}`,
        name: (ov.displayName as string) || name,
        labels: field.labels,
        points,
        color: cssColor(color) ?? (defaults.color?.mode === 'fixed' ? cssColor(defaults.color.fixedColor) : undefined),
        unit: (ov.unit as string) ?? (cfg.unit as string) ?? defaults.unit,
        decimals: (ov.decimals as number) ?? defaults.decimals,
      });
    });
  }
  out.forEach((s, i) => { if (!s.color) s.color = PALETTE[i % PALETTE.length]; });
  return out;
}

/** Number fields of frames without a time column (instant / table results). */
export function framesToValues(frames: GrafanaFrame[], panel?: GrafanaPanel): Series[] {
  const series = framesToSeries(frames, panel);
  if (series.length > 0) return series;
  const out: Series[] = [];
  for (const frame of frames) {
    const fields = frame.schema.fields;
    const strIdx = fields.findIndex((f) => f.type === 'string');
    fields.forEach((field, i) => {
      if (field.type !== 'number') return;
      const vals = fieldValues(frame, i);
      vals.forEach((v, r) => {
        const label = strIdx >= 0 ? String(frame.data.values[strIdx]?.[r] ?? '') : (labelName(field.labels) || field.name);
        out.push({ key: `${i}:${r}`, name: label || field.name, labels: field.labels, points: [{ t: r, v: toNumber(v) }] });
      });
    });
  }
  out.forEach((s, i) => { s.color = PALETTE[i % PALETTE.length]; });
  return out;
}

export type Calc = 'lastNotNull' | 'last' | 'firstNotNull' | 'first' | 'mean' | 'max' | 'min' | 'sum' | 'count' | 'range' | 'delta' | 'diff';

export function reduce(points: SeriesPoint[], calc: string = 'lastNotNull'): number | null {
  const vals = points.map((p) => p.v);
  const nn = vals.filter((v): v is number => v !== null);
  switch (calc) {
    case 'last': return vals.length ? vals[vals.length - 1] : null;
    case 'first': return vals.length ? vals[0] : null;
    case 'firstNotNull': return nn.length ? nn[0] : null;
    case 'mean': return nn.length ? nn.reduce((a, b) => a + b, 0) / nn.length : null;
    case 'max': return nn.length ? Math.max(...nn) : null;
    case 'min': return nn.length ? Math.min(...nn) : null;
    case 'sum': return nn.reduce((a, b) => a + b, 0);
    case 'count': return vals.length;
    case 'range': return nn.length ? Math.max(...nn) - Math.min(...nn) : null;
    case 'diff':
    case 'delta': return nn.length > 1 ? nn[nn.length - 1] - nn[0] : null;
    default: return nn.length ? nn[nn.length - 1] : null;
  }
}

/** Threshold color for a value (absolute or percentage mode). */
export function thresholdColor(value: number | null, d: FieldDefaults): string | undefined {
  const steps = d.thresholds?.steps;
  if (!steps?.length || value === null) return undefined;
  let v = value;
  if (d.thresholds?.mode === 'percentage') {
    const min = d.min ?? 0;
    const max = d.max ?? 100;
    v = max === min ? 0 : ((value - min) / (max - min)) * 100;
  }
  let color = steps[0].color;
  for (const s of steps) {
    if (s.value === null || s.value === undefined || v >= s.value) color = s.color;
  }
  return cssColor(color);
}

/** Value mappings (value → text/color, range, special). */
export function mapValue(value: unknown, d: FieldDefaults): { text?: string; color?: string } | null {
  for (const m of d.mappings ?? []) {
    const type = m.type as string;
    const opts = (m.options ?? {}) as Record<string, { text?: string; color?: string }> & {
      from?: number; to?: number; match?: string; result?: { text?: string; color?: string };
    };
    if (type === 'value') {
      const hit = opts[String(value)];
      if (hit) return { text: hit.text, color: cssColor(hit.color) };
    } else if (type === 'range') {
      const n = toNumber(value);
      if (n !== null && (opts.from == null || n >= opts.from) && (opts.to == null || n <= opts.to)) {
        return { text: opts.result?.text, color: cssColor(opts.result?.color) };
      }
    } else if (type === 'special') {
      const isNull = value === null || value === undefined;
      if ((opts.match === 'null' || opts.match === 'null+nan') && isNull) {
        return { text: opts.result?.text, color: cssColor(opts.result?.color) };
      }
    }
  }
  return null;
}

// ── tables ──────────────────────────────────────────────────────────

export interface TableData {
  columns: Array<{ name: string; type?: string; unit?: string }>;
  rows: unknown[][];
}

/** Prometheus/Loki style series frames (time + one labelled number field
 *  each) merge into ONE table the way Grafana's "Table" format shows them:
 *  Time | label columns… | Value (#refId when several queries). */
function seriesFramesToTable(frames: GrafanaFrame[]): TableData | null {
  const isSeries = (f: GrafanaFrame) => {
    const nums = f.schema.fields.filter((x) => x.type === 'number');
    return f.schema.fields.some((x) => x.type === 'time') && nums.length === 1 && f.schema.fields.length === 2;
  };
  if (frames.length < 1 || !frames.every(isSeries)) return null;
  if (!frames.some((f) => Object.keys(f.schema.fields.find((x) => x.type === 'number')?.labels ?? {}).length)) return null;
  const refIds = [...new Set(frames.map((f) => f.schema.refId ?? 'A'))];
  const labelKeys = [...new Set(frames.flatMap((f) => Object.keys(f.schema.fields.find((x) => x.type === 'number')?.labels ?? {})))].sort((a, b) => (a === '__name__' ? -1 : b === '__name__' ? 1 : a.localeCompare(b)));
  const valueCols = refIds.length > 1 ? refIds.map((r) => `Value #${r}`) : ['Value'];
  const unit = frames[0].schema.fields.find((x) => x.type === 'number')?.config?.unit as string | undefined;
  const columns: TableData['columns'] = [{ name: 'Time', type: 'time' }, ...labelKeys.map((k) => ({ name: k, type: 'string' })), ...valueCols.map((n) => ({ name: n, type: 'number', unit }))];
  const rows: unknown[][] = [];
  for (const f of frames) {
    const ti = f.schema.fields.findIndex((x) => x.type === 'time');
    const vi = f.schema.fields.findIndex((x) => x.type === 'number');
    const labels = f.schema.fields[vi].labels ?? {};
    const times = fieldValues(f, ti);
    const vals = fieldValues(f, vi);
    const col = refIds.length > 1 ? refIds.indexOf(f.schema.refId ?? 'A') : 0;
    for (let r = 0; r < times.length; r++) {
      const row: unknown[] = [times[r], ...labelKeys.map((k) => labels[k] ?? '')];
      for (let c = 0; c < valueCols.length; c++) row.push(c === col ? vals[r] : null);
      rows.push(row);
    }
  }
  return { columns, rows };
}

export function framesToTable(frames: GrafanaFrame[]): TableData[] {
  const merged = seriesFramesToTable(frames);
  if (merged) return [merged];
  return frames.map((frame) => {
    const fields = frame.schema.fields;
    const n = Math.max(0, ...fields.map((_, i) => frame.data.values[i]?.length ?? 0));
    const cols = fields.map((f) => {
      const ln = f.labels && Object.keys(f.labels).length ? ` ${labelName(f.labels)}` : '';
      return { name: ((f.config?.displayNameFromDS as string) || f.name) + (f.type === 'number' && ln && fields.length <= 3 ? ln : ''), type: f.type, unit: f.config?.unit as string | undefined };
    });
    const vals = fields.map((_, i) => fieldValues(frame, i));
    const rows: unknown[][] = [];
    for (let r = 0; r < n; r++) rows.push(vals.map((v) => v[r]));
    return { columns: cols, rows };
  });
}

// ── logs ────────────────────────────────────────────────────────────

export interface LogRow {
  t: number;
  line: string;
  labels: Record<string, string>;
  level?: string;
}

export function framesToLogs(frames: GrafanaFrame[]): LogRow[] {
  const out: LogRow[] = [];
  for (const frame of frames) {
    const f = frame.schema.fields;
    const timeIdx = f.findIndex((x) => x.type === 'time');
    let lineIdx = f.findIndex((x) => /^(line|body)$/i.test(x.name));
    if (lineIdx < 0) lineIdx = f.findIndex((x) => x.type === 'string');
    const labelsIdx = f.findIndex((x) => x.name === 'labels' || x.type === 'other');
    if (timeIdx < 0 || lineIdx < 0) continue;
    const times = frame.data.values[timeIdx] ?? [];
    for (let r = 0; r < times.length; r++) {
      const rawLabels = labelsIdx >= 0 ? frame.data.values[labelsIdx]?.[r] : f[lineIdx].labels;
      const labels = (typeof rawLabels === 'string' ? safeJSON(rawLabels) : rawLabels) as Record<string, string> | undefined;
      const lv = labels?.level || labels?.detected_level || labels?.severity;
      out.push({ t: toTime(times[r]) ?? 0, line: String(frame.data.values[lineIdx]?.[r] ?? ''), labels: labels ?? {}, level: lv });
    }
  }
  out.sort((a, b) => b.t - a.t);
  return out;
}

function safeJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

/** True when the frames are log lines (Loki logs, logs data-plane frames). */
export function isLogFrames(frames: GrafanaFrame[]): boolean {
  return frames.some((fr) => {
    const meta = (fr.schema.meta ?? {}) as { type?: string; preferredVisualisationType?: string; custom?: { frameType?: string } };
    return meta.preferredVisualisationType === 'logs' || meta.type === 'log-lines' || meta.custom?.frameType === 'LabeledTimeValues'
      || fr.schema.fields.some((x) => /^(line|body)$/i.test(x.name));
  });
}
