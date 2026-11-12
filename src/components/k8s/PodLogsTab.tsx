import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, ArrowDown, ChevronDown, ChevronRight, ChevronUp, Download, Loader2, Search } from 'lucide-react';
import { k8sAPI, type DBScope } from '@/services/api';
import type { ResourceRow } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { downloadText } from '@/lib/downloadText';
import { cn } from '@/lib/utils';
import {
  advanceCursor, buildLogLine, createResumeFilter, createSseDecoder, formatTs, isErrorLine, nextMatch,
  parseTailDraft, passesLevel,
  type LevelFilter, type LogCursor, type LogLevel, type LogLine, type SplitLine, type SseFrame, splitTimestamp,
} from './podLogs';

// Lines kept in memory; past MAX_LINES the oldest are dropped down to TRIM_TO
// (never the newest). Line ids keep counting, so search anchors survive a trim.
const MAX_LINES = 100_000;
const TRIM_TO = 90_000;
// A resumed follow stream asks for at most this many lines since the cursor.
const RESUME_TAIL = 10_000;
// Reconnect backoff for a follow stream that dropped / ended / failed.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
// A follow stream that delivered no bytes for this long is treated as dead
// and resumed. The BE opens follow streams with an SSE heartbeat and repeats it
// every 15s, so this only fires on a stalled hop (a proxy that keeps the client
// socket open after the upstream died). Armed only once a heartbeat was seen —
// an older BE sends none, and a quiet pod must not look stalled.
const STALL_MS = 45_000;
// Consecutive reconnects that bring nothing new (no lines, connection gone
// within a few seconds: the container terminated, the pod was deleted, a bad
// container name) before the live view gives up; toggling Follow resumes.
const MAX_IDLE_RETRIES = 6;
const PROGRESS_MS = 30_000;

interface LogBuffer {
  key: string; // stream target the lines belong to
  lines: LogLine[];
  nextId: number;
  cursor: LogCursor | null; // newest timestamp seen — the resume point
  errors: number; // error/fatal lines (not stack continuations) in `lines`
  levelled: number; // lines with any level — shows the level column
  structured: number; // JSON lines — shows the expand column
}

const emptyBuffer = (key: string): LogBuffer => ({ key, lines: [], nextId: 1, cursor: null, errors: 0, levelled: 0, structured: 0 });

function pushLine(b: LogBuffer, split: SplitLine) {
  const line = buildLogLine(b.nextId++, split, b.lines[b.lines.length - 1]);
  b.lines.push(line);
  if (split.ts && split.key) b.cursor = advanceCursor(b.cursor, split.ts, split.key);
  if (isErrorLine(line)) b.errors++;
  if (line.level) b.levelled++;
  if (line.s) b.structured++;
  if (b.lines.length > MAX_LINES) {
    const drop = b.lines.length - TRIM_TO;
    for (let i = 0; i < drop; i++) {
      if (isErrorLine(b.lines[i])) b.errors--;
      if (b.lines[i].level) b.levelled--;
      if (b.lines[i].s) b.structured--;
    }
    b.lines.splice(0, drop);
  }
}

function extractErr(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

// ── Logs tab (pods only, SSE stream) ────────────────────────────────────────
// One row per log line: kubectl timestamp column, level badge, structured
// (JSON) lines as message + compact fields with the raw JSON on expand. Level
// filter + error count, in-log search (Enter / ⇧Enter step through matches,
// optionally only matches), downloads. Virtualized.
//
// Streaming contract (the "mixed up / missing lines" fix):
//  - Every stream run owns a generation flag; after cleanup it never touches
//    state again, so a superseded stream can't interleave into the new view.
//  - The stream always carries kubectl timestamps (the Timestamps switch only
//    shows/hides the column), giving a resume cursor: a dropped or ended follow
//    stream reconnects with sinceTime=cursor and the overlap is deduped — the
//    newest lines are never lost and never duplicated.
//  - TAIL commits on Enter / blur / a pause in typing, not per keystroke.
export function PodLogsTab({
  row, obj, connId, context, scope,
}: {
  row: ResourceRow;
  obj: Record<string, unknown> | null;
  connId: string;
  context: string;
  scope: DBScope;
}) {
  const { t } = useTranslation('k8s');
  const { toast } = useToast();
  const containers = useMemo(() => {
    const spec = (obj?.spec ?? {}) as Record<string, unknown>;
    const main = Array.isArray(spec.containers) ? spec.containers : [];
    const init = Array.isArray(spec.initContainers) ? spec.initContainers : [];
    return [...main, ...init]
      .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).name : undefined))
      .filter((n): n is string => typeof n === 'string');
  }, [obj]);

  const [containerPick, setContainerPick] = useState('');
  const container = containerPick || containers[0] || '';
  const [follow, setFollow] = useState(true);
  const [timestamps, setTimestamps] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [tailLines, setTailLines] = useState(200);
  const [tailDraft, setTailDraft] = useState('200');
  const [streaming, setStreaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [logErr, setLogErr] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [query, setQuery] = useState('');
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [jump, setJump] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [atBottom, setAtBottom] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // ── buffer ──
  // Lines live in a ref (appends are O(1)); `view` is the render snapshot,
  // bumped at most once per animation frame while a stream is busy.
  const target = JSON.stringify([connId, context, scope, row.namespace, row.name, container, previous, tailLines]);
  const bufRef = useRef<LogBuffer>(emptyBuffer(''));
  const [view, setView] = useState({ lines: [] as LogLine[], errors: 0, levelled: 0, structured: 0 });
  const rafRef = useRef(0);
  const publish = useCallback(() => {
    const b = bufRef.current;
    setView({ lines: b.lines, errors: b.errors, levelled: b.levelled, structured: b.structured });
  }, []);
  const schedulePublish = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; publish(); });
  }, [publish]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // ── TAIL: commit on a pause in typing (valid values only), Enter or blur ──
  useEffect(() => {
    const n = parseTailDraft(tailDraft);
    if (n == null || n === tailLines) return;
    const h = setTimeout(() => { setTailLines(n); setTailDraft(String(n)); }, 900);
    return () => clearTimeout(h);
  }, [tailDraft, tailLines]);
  const commitTail = () => {
    const n = parseTailDraft(tailDraft);
    setTailDraft(String(n ?? tailLines));
    if (n != null && n !== tailLines) setTailLines(n);
  };

  // ── stream ──
  useEffect(() => {
    if (bufRef.current.key !== target) {
      bufRef.current = emptyBuffer(target);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      publish();
      setActiveId(null);
      setExpanded(new Set());
      stickRef.current = true;
      setAtBottom(true);
    }
    if (!connId || !context) return;
    const b = bufRef.current;
    const ac = new AbortController();
    let alive = true; // this run's generation — false once superseded
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    setLogErr('');
    setStreaming(true);
    setReconnecting(false);

    const connect = async () => {
      const keep = createResumeFilter(b.cursor);
      let gotLines = false;
      let err = '';
      let fatal = false;
      // Per-connection abort: the run's cleanup or the stall watchdog.
      const conn = new AbortController();
      const stop = () => conn.abort();
      ac.signal.addEventListener('abort', stop, { once: true });
      const startedAt = Date.now();
      let lastByte = startedAt;
      let heartbeats = false;
      let stalled = false;
      const watchdog = follow
        ? setInterval(() => {
          if (heartbeats && Date.now() - lastByte > STALL_MS) { stalled = true; conn.abort(); }
        }, 5000)
        : undefined;
      try {
        const { url } = k8sAPI.logsUrl(connId, {
          context,
          namespace: row.namespace || undefined,
          pod: row.name,
          container: container || undefined,
          follow,
          timestamps: true,
          previous,
          tailLines: b.cursor ? RESUME_TAIL : tailLines,
          sinceTime: b.cursor?.ts,
        }, scope);
        const res = await fetch(url, { signal: conn.signal });
        if (!alive) return;
        if (!res.ok || !res.body) {
          err = t('logs.streamFailed', { status: res.status });
          fatal = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        } else {
          const reader = res.body.getReader();
          conn.signal.addEventListener('abort', () => { reader.cancel().catch(() => {}); }, { once: true });
          const dec = new TextDecoder();
          const sse = createSseDecoder();
          const onFrames = (frames: SseFrame[]) => {
            let added = false;
            for (const f of frames) {
              if (f.event === '') {
                const split = splitTimestamp(f.data);
                if (!keep(split.key)) continue;
                pushLine(b, split);
                added = true;
              } else if (f.event === 'error') {
                try { err = (JSON.parse(f.data) as { message?: string }).message ?? f.data; } catch { err = f.data; }
              }
            }
            if (added) {
              if (!gotLines) { gotLines = true; setLogErr(''); }
              schedulePublish();
            }
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (!alive) return;
            if (done) break;
            lastByte = Date.now();
            onFrames(sse.push(dec.decode(value, { stream: true })));
            if (!heartbeats && sse.comments > 0) heartbeats = true;
          }
          onFrames(sse.push(dec.decode()));
          onFrames(sse.end());
        }
      } catch (e) {
        if (!alive) return;
        if (!stalled) err = extractErr(e, t('logs.streamError'));
      } finally {
        clearInterval(watchdog);
        ac.signal.removeEventListener('abort', stop);
      }
      if (!alive) return;
      setLogErr(err);
      // Progress = new lines, or a connection that lived a while (a long
      // healthy follow that then dropped/stalled is not a failure).
      if (gotLines || Date.now() - startedAt > PROGRESS_MS) attempt = 0;
      if (follow && !previous && !fatal && attempt < MAX_IDLE_RETRIES) {
        // A live view must not go quiet: resume from the newest line seen.
        setReconnecting(true);
        const delay = RETRY_DELAYS[Math.min(attempt++, RETRY_DELAYS.length - 1)];
        timer = setTimeout(() => {
          if (!alive) return;
          setReconnecting(false);
          void connect();
        }, delay);
        return;
      }
      setStreaming(false);
      setReconnecting(false);
    };
    void connect();
    return () => {
      alive = false;
      ac.abort();
      if (timer) clearTimeout(timer);
    };
  }, [target, connId, context, scope, row.namespace, row.name, container, follow, previous, tailLines, t, publish, schedulePublish]);

  // ── filter + search ──
  const q = useDeferredValue(query.trim().toLowerCase());
  const { shown, matchIds } = useMemo(() => {
    const shown: LogLine[] = [];
    const matchIds: number[] = [];
    for (const l of view.lines) {
      if (!passesLevel(l, level)) continue;
      const hit = !!q && l.lc.includes(q);
      if (hit) matchIds.push(l.id);
      if (q && onlyMatches && !hit) continue;
      shown.push(l);
    }
    return { shown, matchIds };
  }, [view, level, q, onlyMatches]);
  // The active match is a line id (stable while lines stream in); if it stops
  // matching it falls back to the first match.
  const current = activeId != null && matchIds.includes(activeId) ? activeId : (matchIds[0] ?? null);
  const currentPos = current == null ? -1 : matchIds.indexOf(current);
  const step = (dir: 1 | -1) => {
    const next = nextMatch(matchIds, current, dir);
    if (next == null) return;
    setActiveId(next);
    setJump((n) => n + 1);
  };
  useEffect(() => { setActiveId(null); setJump((n) => n + 1); }, [q]);
  useEffect(() => { setJump((n) => n + 1); }, [onlyMatches, level]);

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 30,
    getItemKey: (i) => shown[i]?.id ?? i,
  });

  // Scroll to the active match only when the user moved it (step / new query /
  // filter change) — not on every streamed chunk.
  const handledJump = useRef(0);
  useEffect(() => {
    if (handledJump.current === jump) return;
    handledJump.current = jump;
    if (!q || current == null) return;
    const idx = shown.findIndex((l) => l.id === current);
    if (idx >= 0) {
      stickRef.current = false;
      virtualizer.scrollToIndex(idx, { align: 'center' });
    }
  }, [jump, q, current, shown, virtualizer]);

  // Stick to the newest line unless the user scrolled up (or is searching).
  // logErr / timestamps also re-run it: the error banner and the timestamp
  // column change the viewport / row heights without new lines arriving.
  useLayoutEffect(() => {
    if (q || !stickRef.current || shown.length === 0) return;
    virtualizer.scrollToIndex(shown.length - 1, { align: 'end' });
  }, [shown, q, virtualizer, logErr, timestamps]);

  // Only a user gesture (wheel / touch / keys / scrollbar drag) unsticks — row
  // re-measures and the virtualizer's own scroll corrections must not.
  const userScrollUntil = useRef(0);
  const dragging = useRef(false);
  const markUserScroll = () => { userScrollUntil.current = performance.now() + 300; };
  const onPointerDown = () => {
    dragging.current = true;
    window.addEventListener('pointerup', () => { dragging.current = false; }, { once: true });
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (near) stickRef.current = true;
    else if (dragging.current || performance.now() < userScrollUntil.current) stickRef.current = false;
    setAtBottom(stickRef.current);
  };
  const toLatest = () => {
    stickRef.current = true;
    setAtBottom(true);
    if (shown.length) virtualizer.scrollToIndex(shown.length - 1, { align: 'end' });
  };

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── download ──
  const fileBase = `${row.name}${container ? `_${container}` : ''}${previous ? '_previous' : ''}`;
  const downloadVisible = () => {
    downloadText(`${fileBase}.log`, shown.map((l) => (timestamps && l.ts ? `${l.ts} ${l.text}` : l.text)).join('\n') + '\n');
  };
  const downloadFull = async () => {
    setDownloading(true);
    try {
      const { url } = k8sAPI.logsUrl(connId, {
        context, namespace: row.namespace || undefined, pod: row.name, container: container || undefined,
        follow: false, tailLines: 'all', timestamps, previous,
      }, scope);
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(t('logs.streamFailed', { status: res.status }));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const sse = createSseDecoder();
      const out: string[] = [];
      let streamErr = '';
      const take = (frames: SseFrame[]) => {
        for (const f of frames) {
          if (f.event === '') out.push(f.data);
          else if (f.event === 'error') {
            try { streamErr = (JSON.parse(f.data) as { message?: string }).message ?? f.data; } catch { streamErr = f.data; }
          }
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        take(sse.push(dec.decode(value, { stream: true })));
      }
      take(sse.push(dec.decode()));
      take(sse.end());
      if (streamErr) throw new Error(streamErr);
      downloadText(`${fileBase}_full.log`, out.length ? out.join('\n') + '\n' : '');
    } catch (e) {
      toast({ title: t('logs.downloadFailed'), description: extractErr(e, t('logs.streamError')), variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const showLevels = view.levelled > 0;
  const hasLines = view.lines.length > 0;
  const levelOptions: { id: LevelFilter; label: string }[] = [
    { id: 'all', label: t('logs.levelAll') },
    { id: 'warn', label: t('logs.levelWarn') },
    { id: 'error', label: t('logs.levelError') },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20 flex-wrap">
        <Select value={container} onValueChange={setContainerPick} disabled={containers.length === 0}>
          <SelectTrigger className="w-[160px] h-7 text-xs"><SelectValue placeholder={t('logs.container')} /></SelectTrigger>
          <SelectContent>
            {containers.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div
          className="flex items-center h-7 rounded-md border bg-background px-2 gap-1.5"
          title={t('logs.tailTip')}
        >
          <span className="text-[10px] text-muted-foreground select-none">TAIL</span>
          <Input
            inputMode="numeric"
            value={tailDraft}
            onChange={(e) => setTailDraft(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTail(); }
              if (e.key === 'Escape') setTailDraft(String(tailLines));
            }}
            onBlur={commitTail}
            className="h-5 w-16 text-xs px-1 border-0 shadow-none focus-visible:ring-0 bg-transparent tabular-nums"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground">{t('logs.follow')}</Label>
          <Switch checked={follow} onCheckedChange={setFollow} />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground">{t('logs.timestamps')}</Label>
          <Switch checked={timestamps} onCheckedChange={setTimestamps} />
        </div>
        <div className="flex items-center gap-1.5" title={t('logs.previousTip')}>
          <Label className="text-[10px] text-muted-foreground">{t('logs.previous')}</Label>
          <Switch checked={previous} onCheckedChange={setPrevious} />
        </div>
        <div className="flex-1" />
        {reconnecting ? (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('logs.reconnecting')}
          </span>
        ) : streaming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[11px]" disabled={downloading}>
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t('logs.download')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!shown.length} onClick={downloadVisible}>{t('logs.downloadVisible')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void downloadFull()}>{t('logs.downloadFull')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search + level filter */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-b flex-wrap">
        <div className="relative flex-1 min-w-[140px] max-w-sm">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder={t('logs.searchPlaceholder')}
            className="h-7 text-xs pl-7"
          />
        </div>
        {q && (
          <>
            <span className="text-[10px] tabular-nums text-muted-foreground whitespace-nowrap">
              {matchIds.length
                ? t('logs.matchCount', { current: currentPos + 1, total: matchIds.length })
                : t('logs.noMatches')}
            </span>
            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={!matchIds.length} onClick={() => step(-1)} title={t('logs.prevMatch')}>
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={!matchIds.length} onClick={() => step(1)} title={t('logs.nextMatch')}>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <div className="flex items-center gap-1.5 ml-1">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">{t('logs.onlyMatches')}</Label>
              <Switch checked={onlyMatches} onCheckedChange={setOnlyMatches} />
            </div>
          </>
        )}
        <div className="flex-1" />
        {view.errors > 0 && (
          <button
            type="button"
            onClick={() => setLevel('error')}
            className="flex items-center gap-1 rounded px-1.5 h-5 text-[10px] font-medium tabular-nums bg-destructive/10 text-destructive hover:bg-destructive/20"
          >
            <AlertTriangle className="h-3 w-3" />
            {t('logs.errorCount', { count: view.errors })}
          </button>
        )}
        <div
          role="radiogroup"
          aria-label={t('logs.levelFilter')}
          className="flex items-center h-6 rounded-md border bg-background p-0.5 text-[10px]"
        >
          {levelOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={level === o.id}
              onClick={() => setLevel(o.id)}
              className={cn(
                'h-full px-2 rounded-[4px] whitespace-nowrap transition-colors',
                level === o.id ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {logErr && hasLines && (
        <div className="shrink-0 flex items-start gap-2 px-3 py-1 border-b bg-destructive/5 text-[11px] text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span className="font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">{logErr}</span>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
          onKeyDown={markUserScroll}
          onPointerDown={onPointerDown}
          tabIndex={-1}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-muted/10 outline-none"
        >
          {logErr && !hasLines ? (
            <div className="p-4 flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{logErr}</pre>
            </div>
          ) : !hasLines ? (
            <div className="p-3 text-[11px] font-mono text-muted-foreground">
              {streaming ? t('logs.streaming') : t('logs.noLogOutput')}
            </div>
          ) : shown.length === 0 ? (
            <div className="p-3 text-[11px] font-mono text-muted-foreground">
              {q ? t('logs.noMatches') : t('logs.noLinesAtLevel')}
            </div>
          ) : (
            <div className="py-1" style={{ height: virtualizer.getTotalSize() + 8, position: 'relative', width: '100%' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const line = shown[vi.index];
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  >
                    <LogRow
                      line={line}
                      showTs={timestamps}
                      showLevel={showLevels}
                      showExpand={view.structured > 0}
                      q={q}
                      active={line.id === current}
                      expanded={expanded.has(line.id)}
                      onToggle={toggleExpanded}
                      expandLabel={t('logs.showRaw')}
                      collapseLabel={t('logs.hideRaw')}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {!atBottom && hasLines && !q && (
          <Button
            size="sm"
            variant="secondary"
            onClick={toLatest}
            className="absolute bottom-3 right-4 h-7 gap-1 text-[11px] shadow-md"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {t('logs.jumpToLatest')}
          </Button>
        )}
      </div>
    </div>
  );
}

const LEVEL_BADGE: Record<LogLevel, string> = {
  trace: 'text-muted-foreground bg-muted',
  debug: 'text-muted-foreground bg-muted',
  info: 'text-sky-700 bg-sky-500/10 dark:text-sky-300 dark:bg-sky-400/10',
  warn: 'text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15',
  error: 'text-destructive bg-destructive/15',
  fatal: 'text-destructive-foreground bg-destructive',
};

const LogRow = memo(function LogRow({
  line, showTs, showLevel, showExpand, q, active, expanded, onToggle, expandLabel, collapseLabel,
}: {
  line: LogLine;
  showTs: boolean;
  showLevel: boolean;
  showExpand: boolean;
  q: string;
  active: boolean;
  expanded: boolean;
  onToggle: (id: number) => void;
  expandLabel: string;
  collapseLabel: string;
}) {
  const lvl = line.level;
  const isErr = lvl === 'error' || lvl === 'fatal';
  const isWarn = lvl === 'warn';
  const s = line.s;
  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 font-mono text-[11px] leading-[18px] border-l-2',
        isErr ? 'border-destructive bg-destructive/[0.07]' : isWarn ? 'border-amber-500/70 bg-amber-500/[0.06]' : 'border-transparent hover:bg-muted/40',
        active && 'bg-amber-400/25 dark:bg-amber-500/25',
      )}
    >
      {showTs && (
        <span className="shrink-0 w-[18ch] text-muted-foreground/80 tabular-nums" title={line.ts ?? undefined}>
          {line.ts ? formatTs(line.ts) : ''}
        </span>
      )}
      {showLevel && (
        <span className="shrink-0 w-[46px] pt-[1px]">
          {lvl && !line.cont && (
            <span className={cn('block text-center rounded-[3px] text-[9.5px] font-semibold leading-[16px] tracking-wide', LEVEL_BADGE[lvl])}>
              {lvl.toUpperCase()}
            </span>
          )}
        </span>
      )}
      {showExpand && (
        <span className="shrink-0 w-3 -mx-1 flex">
          {s && (
            <button
              type="button"
              onClick={() => onToggle(line.id)}
              title={expanded ? collapseLabel : expandLabel}
              aria-label={expanded ? collapseLabel : expandLabel}
              aria-expanded={expanded}
              className="h-[18px] w-3 flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </span>
      )}
      <div className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {s ? (
          <>
            {s.msg != null && (
              <span className={cn('font-medium', isErr ? 'text-destructive' : 'text-foreground')}>{highlight(s.msg, q)}</span>
            )}
            {s.fields.map(([k, v], i) => (
              <span key={k}>
                {i > 0 || s.msg != null ? '  ' : ''}
                <span className={i < s.errorKeys ? 'text-destructive' : 'text-muted-foreground'}>
                  <span className="opacity-60">{k}=</span>{highlight(v, q)}
                </span>
              </span>
            ))}
            {expanded && (
              <pre className="my-1 rounded border bg-muted/40 p-2 text-[10.5px] leading-[15px] whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/90">
                {prettyJson(line.text)}
              </pre>
            )}
          </>
        ) : (
          <span className={cn(isErr && !line.cont && 'text-destructive')}>{highlight(line.text, q)}</span>
        )}
      </div>
    </div>
  );
});

function prettyJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// Wrap every case-insensitive occurrence of `q` in a <mark>.
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text || ' ';
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i} className="rounded-sm bg-amber-300/70 dark:bg-amber-500/40 text-inherit">{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out.length ? out : text || ' ';
}
