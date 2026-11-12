// Pure helpers behind the pod-log viewer (PodLogsTab): SSE framing, kubectl
// timestamp handling + resume dedupe, and structured-line parsing. No React and
// no imports, so it runs under plain node for tests.

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const LEVEL_RANK: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

// ── SSE framing ──────────────────────────────────────────────────────────────

export interface SseFrame {
  event: string; // '' for a plain data frame (one log line)
  data: string;
}

// createSseDecoder splits the logs SSE stream into frames. A frame can straddle
// network reads, so the trailing partial frame is held until the next push();
// call end() once the body is done. Frames without data (the BE's
// `: keepalive` heartbeat comments) are dropped but counted in `comments` —
// a stream that heartbeats can be watched for stalls.
export function createSseDecoder() {
  let buf = '';
  let comments = 0;
  const parse = (f: string): SseFrame | null => {
    let event = '';
    const data: string[] = [];
    for (const line of f.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
      else if (line.startsWith(':')) comments++;
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  return {
    get comments() { return comments; },
    push(chunk: string): SseFrame[] {
      buf += chunk;
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      const out: SseFrame[] = [];
      for (const p of parts) {
        const f = parse(p);
        if (f) out.push(f);
      }
      return out;
    },
    end(): SseFrame[] {
      const rest = buf;
      buf = '';
      const f = rest.trim() ? parse(rest) : null;
      return f ? [f] : [];
    },
  };
}

// ── kubectl timestamps + resume ──────────────────────────────────────────────

const TS_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})(?: |$)/;

export interface SplitLine {
  ts: string | null; // the kubectl RFC3339Nano prefix, verbatim
  key: string | null; // fixed-width sortable form of ts (epoch seconds + 9-digit fraction)
  text: string; // the log line itself
}

// splitTimestamp peels the `--timestamps` prefix off a log line. RFC3339Nano
// trims trailing zeros of the fraction, so the raw strings don't sort — key
// does (and is offset-normalized).
export function splitTimestamp(raw: string): SplitLine {
  const m = TS_RE.exec(raw);
  if (!m) return { ts: null, key: null, text: raw };
  const ms = Date.parse(`${m[1]}T${m[2]}${m[4]}`);
  if (Number.isNaN(ms)) return { ts: null, key: null, text: raw };
  const key = `${String(Math.floor(ms / 1000)).padStart(12, '0')}.${(m[3] ?? '').padEnd(9, '0')}`;
  return { ts: raw.slice(0, m[0].length).trimEnd(), key, text: raw.slice(m[0].length) };
}

// LogCursor is the newest line seen: its timestamp and how many lines carried
// exactly that timestamp (two lines can share one).
export interface LogCursor {
  ts: string;
  key: string;
  dup: number;
}

export function advanceCursor(c: LogCursor | null, ts: string, key: string): LogCursor {
  return c && c.key === key ? { ts, key, dup: c.dup + 1 } : { ts, key, dup: 1 };
}

// createResumeFilter drops the overlap a resumed stream re-delivers. The resume
// asks for sinceTime = cursor.ts, which the API truncates to the second (an
// older BE ignores it and re-tails), so the new stream starts at or before the
// cursor: drop every line older than the cursor and the first `dup` lines at
// its exact timestamp; once a newer line passes, everything passes.
export function createResumeFilter(c: LogCursor | null): (key: string | null) => boolean {
  if (!c) return () => true;
  let passed = false;
  let atCursor = 0;
  return (key) => {
    if (passed) return true;
    if (key == null || key < c.key) return false;
    if (key === c.key) {
      atCursor++;
      if (atCursor <= c.dup) return false;
    }
    passed = true;
    return true;
  };
}

// formatTs renders the kubectl timestamp for the narrow timestamp column:
// "MM-DD HH:MM:SS.mmm", as written (no timezone conversion — same clock as
// kubectl / the download).
export function formatTs(ts: string): string {
  const m = TS_RE.exec(ts);
  if (!m) return ts;
  const frac = (m[3] ?? '').padEnd(3, '0').slice(0, 3);
  return `${m[1].slice(5)} ${m[2]}.${frac}`;
}

// ── structured lines ─────────────────────────────────────────────────────────

const LEVEL_KEYS = ['level', 'lvl', 'severity', 'loglevel', 'log.level', 'levelname', '@l', 'severity_text'];
const MSG_KEYS = ['msg', 'message', '@m', '@mt', 'event'];
const ERROR_KEYS = new Set(['error', 'err', 'error.message', 'exception', '@x', 'stack', 'stacktrace', 'stack_trace']);
const TIME_KEYS = new Set(['time', 'ts', 'timestamp', '@timestamp', '@t', 't', 'datetime']);

// normalizeLevel maps the level spellings of logrus / zap / slog / zerolog /
// pino+bunyan (numeric) / serilog / python / syslog onto six levels.
export function normalizeLevel(v: unknown): LogLevel | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v >= 10) {
      // pino / bunyan: 10 trace … 60 fatal
      if (v >= 60) return 'fatal';
      if (v >= 50) return 'error';
      if (v >= 40) return 'warn';
      if (v >= 30) return 'info';
      if (v >= 20) return 'debug';
      return 'trace';
    }
    return null;
  }
  if (typeof v !== 'string') return null;
  switch (v.trim().toLowerCase()) {
    case 'trace': case 'trc': case 'verbose': case 'vrb': case 'finest': case 'finer':
      return 'trace';
    case 'debug': case 'dbg': case 'fine':
      return 'debug';
    case 'info': case 'inf': case 'information': case 'notice':
      return 'info';
    case 'warn': case 'warning': case 'wrn':
      return 'warn';
    case 'error': case 'err': case 'eror': case 'severe':
      return 'error';
    case 'fatal': case 'ftl': case 'crit': case 'critical': case 'alert': case 'emerg': case 'emergency': case 'panic': case 'dpanic':
      return 'fatal';
    default:
      return null;
  }
}

const KLOG_RE = /^([IWEF])\d{4} \d{2}:\d{2}:\d{2}/;
const KLOG_LEVEL: Record<string, LogLevel> = { I: 'info', W: 'warn', E: 'error', F: 'fatal' };
const LOGFMT_RE = /(?:^|\s)(?:level|lvl|severity)=["']?([A-Za-z]+)/i;
const BRACKET_RE = /\[(trace|debug|info|warn|warning|error|fatal|panic|crit|critical)\]/i;
const UPPER_RE = /(?:^|[^A-Za-z0-9_])(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|PANIC|CRITICAL|CRIT|SEVERE)(?![A-Za-z0-9_])/;
const FATAL_START_RE = /^(panic: |fatal error: )/;
const ERROR_START_RE = /^(Traceback \(most recent call last\)|Exception in thread |Unhandled exception)/;
// Stack-trace / wrapped continuation of the previous line.
const CONT_RE = /^(\s+\S|Caused by:|\.\.\. \d+ more)/;

// plainLevel finds the level of an unstructured line from its first 256 chars:
// klog/glog prefixes, logfmt level=, [level] tags, then UPPERCASE keywords.
export function plainLevel(text: string): LogLevel | null {
  const head = text.length > 256 ? text.slice(0, 256) : text;
  const k = KLOG_RE.exec(head);
  if (k) return KLOG_LEVEL[k[1]];
  if (FATAL_START_RE.test(head)) return 'fatal';
  if (ERROR_START_RE.test(head)) return 'error';
  const f = LOGFMT_RE.exec(head);
  if (f) {
    const l = normalizeLevel(f[1]);
    if (l) return l;
  }
  const b = BRACKET_RE.exec(head);
  if (b) return normalizeLevel(b[1]);
  const u = UPPER_RE.exec(head);
  return u ? normalizeLevel(u[1]) : null;
}

const MAX_FIELD_CHARS = 400;

function fieldText(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v === '' || /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  else if (v === null || typeof v !== 'object') s = String(v);
  else s = JSON.stringify(v);
  return s.length > MAX_FIELD_CHARS ? `${s.slice(0, MAX_FIELD_CHARS)}…` : s;
}

export interface Structured {
  level: LogLevel | null;
  msg: string | null;
  fields: Array<[string, string]>; // everything but level + message: errors first, time last
  errorKeys: number; // how many leading fields are error fields
}

// parseStructured reads a JSON-object log line; null for anything else.
export function parseStructured(text: string): Structured | null {
  const s = text.trim();
  if (s.length < 2 || s[0] !== '{' || s[s.length - 1] !== '}') return null;
  let obj: unknown;
  try { obj = JSON.parse(s); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const byLower = new Map<string, string>();
  for (const k of Object.keys(rec)) if (!byLower.has(k.toLowerCase())) byLower.set(k.toLowerCase(), k);
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const real = byLower.get(k);
      if (real !== undefined && rec[real] != null && rec[real] !== '') return real;
    }
    return null;
  };
  const levelKey = pick(LEVEL_KEYS);
  const msgKey = pick(MSG_KEYS);
  const msgVal = msgKey ? rec[msgKey] : null;
  const errs: Array<[string, string]> = [];
  const rest: Array<[string, string]> = [];
  const times: Array<[string, string]> = [];
  for (const k of Object.keys(rec)) {
    if (k === levelKey || k === msgKey) continue;
    const lk = k.toLowerCase();
    const entry: [string, string] = [k, fieldText(rec[k])];
    if (ERROR_KEYS.has(lk)) errs.push(entry);
    else if (TIME_KEYS.has(lk)) times.push(entry);
    else rest.push(entry);
  }
  let level = levelKey ? normalizeLevel(rec[levelKey]) : null;
  if (!level && errs.length) level = 'error';
  return {
    level,
    msg: msgVal == null ? null : typeof msgVal === 'string' ? msgVal : JSON.stringify(msgVal),
    fields: [...errs, ...rest, ...times],
    errorKeys: errs.length,
  };
}

// ── line model ───────────────────────────────────────────────────────────────

export interface LogLine {
  id: number; // monotonic per buffer — stable across appends/trims (search anchor, React key)
  ts: string | null;
  text: string;
  level: LogLevel | null;
  cont: boolean; // stack-trace continuation: inherits the previous line's level, no badge
  s: Structured | null;
  lc: string; // lowercase haystack for search (message + raw line)
}

export function buildLogLine(id: number, split: SplitLine, prev: LogLine | undefined): LogLine {
  const { ts, text } = split;
  const s = parseStructured(text);
  if (s) {
    return { id, ts, text, level: s.level, cont: false, s, lc: (s.msg ? `${s.msg}\n${text}` : text).toLowerCase() };
  }
  let level = plainLevel(text);
  let cont = false;
  if (!level && prev && prev.level && CONT_RE.test(text)) {
    level = prev.level;
    cont = true;
  }
  return { id, ts, text, level, cont, s: null, lc: text.toLowerCase() };
}

export type LevelFilter = 'all' | 'warn' | 'error';

export function passesLevel(l: LogLine, f: LevelFilter): boolean {
  if (f === 'all') return true;
  if (!l.level) return false;
  return LEVEL_RANK[l.level] >= (f === 'warn' ? LEVEL_RANK.warn : LEVEL_RANK.error);
}

export function isErrorLine(l: LogLine): boolean {
  return !l.cont && (l.level === 'error' || l.level === 'fatal');
}

// nextMatch steps from the active line id to the next/previous match id
// (wrapping). Ids are stable while lines stream in, so the selection doesn't
// drift the way an index into a sliding window did.
export function nextMatch(matchIds: number[], activeId: number | null, dir: 1 | -1): number | null {
  if (!matchIds.length) return null;
  if (activeId == null) return dir === 1 ? matchIds[0] : matchIds[matchIds.length - 1];
  if (dir === 1) {
    for (const id of matchIds) if (id > activeId) return id;
    return matchIds[0];
  }
  for (let i = matchIds.length - 1; i >= 0; i--) if (matchIds[i] < activeId) return matchIds[i];
  return matchIds[matchIds.length - 1];
}

// parseTailDraft validates the TAIL box text; null keeps the current value.
export const MAX_TAIL_LINES = 100_000;
export function parseTailDraft(draft: string): number | null {
  const s = draft.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (n < 1) return null;
  return Math.min(n, MAX_TAIL_LINES);
}
