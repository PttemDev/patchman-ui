// Smart formatters for DB result cells.
//
// formatCellPreview returns a short, single-line string for the grid;
// formatCellFull returns the long form for the inspector drawer.
// classifyValue tells the renderer which colour/icon to apply so the
// grid stays scannable without losing precision.

export type ValueClass =
  | 'null'
  | 'undefined'
  | 'boolean'
  | 'number'
  | 'bigint'
  | 'date'
  | 'duration'
  | 'bytes'
  | 'uuid'
  | 'url'
  | 'email'
  | 'json'
  | 'jsonb'
  | 'string'
  | 'binary';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_RE = /^https?:\/\/[^\s<>"]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function classifyValue(value: unknown, colType?: string): ValueClass {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'bigint') return 'bigint';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object') {
    const t = (colType || '').toLowerCase();
    return t.includes('jsonb') ? 'jsonb' : 'json';
  }
  if (typeof value === 'string') {
    const s = value;
    const t = (colType || '').toLowerCase();
    // Postgres bytea hex / mysql binary
    if (t === 'bytea' || t === 'blob' || t === 'binary') return 'binary';
    if (UUID_RE.test(s)) return 'uuid';
    if (URL_RE.test(s)) return 'url';
    if (EMAIL_RE.test(s)) return 'email';
    if (ISO_DATE_RE.test(s)) return 'date';
    // Looks like a JSON object/array string
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object') return 'json';
      } catch { /* fallthrough */ }
    }
  }
  return 'string';
}

// Heuristic — column name hints we use to format size/duration nicely.
export function isLikelyBytes(colName: string, colType?: string): boolean {
  const n = colName.toLowerCase();
  if (/(^|_)(size|bytes?|length|content_length|file_size)$/.test(n)) return true;
  const t = (colType || '').toLowerCase();
  if (t.includes('int') && /(_bytes|_size)$/.test(n)) return true;
  return false;
}

export function isLikelyMs(colName: string): boolean {
  return /(_ms|_millis|_milliseconds|_duration_ms)$/.test(colName.toLowerCase());
}

export function isLikelyTimestamp(colType?: string): boolean {
  const t = (colType || '').toLowerCase();
  return t.includes('timestamp') || t.includes('datetime') || t === 'date';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  if (abs < 1024) return `${n} B`;
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return String(ms);
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)} s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)} min`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Grouping for ints, trim trailing zeros for floats.
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatDate(input: unknown): { short: string; full: string; relative: string } {
  let d: Date | null = null;
  if (input instanceof Date) d = input;
  else if (typeof input === 'string') {
    const dt = new Date(input);
    if (!Number.isNaN(dt.getTime())) d = dt;
  } else if (typeof input === 'number') {
    // Heuristic: > 1e11 → assume already ms, else seconds.
    const dt = new Date(input > 1e11 ? input : input * 1000);
    if (!Number.isNaN(dt.getTime())) d = dt;
  }
  if (!d) return { short: String(input), full: String(input), relative: '' };
  const short = d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const full = d.toISOString();
  return { short, full, relative: relativeTime(d) };
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? 'ago' : 'from now';
  const units: Array<[number, string]> = [
    [60_000, 's'],
    [3_600_000, 'm'],
    [86_400_000, 'h'],
    [604_800_000, 'd'],
    [2_629_800_000, 'w'],
    [31_557_600_000, 'mo'],
  ];
  let value = abs / 1000;
  let unit = 's';
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i][0]) { unit = units[i][1]; break; }
    if (i === units.length - 1) { unit = 'y'; value = abs / 31_557_600_000; break; }
    value = abs / units[i][0];
    unit = units[i + 1][1];
  }
  return `${value.toFixed(0)} ${unit} ${sign}`;
}

// formatCellPreview returns the short string the grid cell shows.
export function formatCellPreview(
  value: unknown,
  colName: string,
  colType?: string,
): string {
  if (value === null || value === undefined) return '';
  const cls = classifyValue(value, colType);
  if (cls === 'json' || cls === 'jsonb') {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  if (cls === 'boolean') return String(value);
  if (cls === 'number' || cls === 'bigint') {
    const n = typeof value === 'bigint' ? Number(value) : (value as number);
    if (isLikelyBytes(colName, colType)) return formatBytes(n);
    if (isLikelyMs(colName)) return formatDurationMs(n);
    return formatNumber(n);
  }
  if (cls === 'date' || isLikelyTimestamp(colType)) {
    return formatDate(value).short;
  }
  return String(value);
}

// Heuristic — strip postgres ${schema}.${table} duplication when the
// table prefix matches the column-display table.
export function shortColumnType(t?: string): string {
  if (!t) return '';
  return t.replace(/\([^)]*\)/g, ''); // varchar(255) → varchar
}

// stringify is the safe fallback used by filter/sort/export.
export function stringifyValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
