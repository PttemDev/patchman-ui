import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ChevronDown, ChevronRight, Copy, ExternalLink, LayoutDashboard, Loader2, Plus, RefreshCw, Search, Waves,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { reportCrash } from '@/lib/errorReporter';
import { cn } from '@/lib/utils';
import { graylogAPI, type DBScope } from '@/services/api';
import { useGraylogConnectionStore, scopeForGraylog } from '@/stores/graylogConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import type { GraylogRange, Tab } from '@/types';
import { DEFAULT_RANGE, graylogErr } from './graylogUtil';

// Main-pane body of a `type: 'graylog'` tab (lazy-loaded by TabBody): the log
// search of one Graylog connection, or its dashboards & saved searches list.
// Own error boundary — one view failing must not take the app down.
export default function GraylogTab({ tab }: { tab: Tab }) {
  const view = tab.graylogView ?? 'search';
  return (
    <GraylogBoundary key={`${tab.graylogConnectionId}:${view}`}>
      {view === 'dashboards' ? <DashboardsView tab={tab} /> : <SearchView tab={tab} />}
    </GraylogBoundary>
  );
}

interface Stream { id: string; title: string; description?: string; disabled?: boolean; isDefault?: boolean }
interface Message { id: string; index?: string; timestamp: string; source?: string; message: string; fields: Record<string, unknown> }
interface Bucket { time: string; count: number }
interface SearchResult {
  total: number; messages: Message[]; histogram?: Bucket[]; interval?: string; from?: string; to?: string; tookMs?: number; webUrl?: string;
}
interface View { id: string; type: 'dashboard' | 'search'; title: string; summary?: string; description?: string; owner?: string; updatedAt?: string; webUrl: string }

const PAGE = 100;
// Relative presets, in seconds.
const PRESETS = [300, 900, 3600, 4 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 30 * 86400];

function useConn(tab: Tab): { connId: string; scope: DBScope | undefined; name: string; url: string; ready: boolean } {
  const connections = useGraylogConnectionStore((s) => s.connections);
  const fetchConnections = useGraylogConnectionStore((s) => s.fetchConnections);
  const loaded = useGraylogConnectionStore((s) => s.loaded);
  useEffect(() => { if (!loaded) void fetchConnections(); }, [loaded, fetchConnections]);
  const connId = tab.graylogConnectionId ?? '';
  const conn = connections.find((c) => c.id === connId);
  // ready: the connection list is in, so the scope (local / remote BE) is
  // known — searching before that could hit the wrong backend on desktop.
  return { connId, scope: connections.length ? scopeForGraylog(connections, connId) : undefined, name: conn?.name ?? tab.name, url: conn?.url ?? '', ready: loaded };
}

// ── Search ──────────────────────────────────────────────────────────────

function SearchView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('graylog');
  const updateTab = useRequestStore((s) => s.updateTab);
  const { connId, scope, ready } = useConn(tab);
  const range = tab.graylogRange ?? DEFAULT_RANGE;
  const selected = useMemo(() => tab.graylogStreams ?? [], [tab.graylogStreams]);
  const [draft, setDraft] = useState(tab.graylogQuery ?? '');
  const [streams, setStreams] = useState<Stream[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const seq = useRef(0);

  useEffect(() => { setDraft(tab.graylogQuery ?? ''); }, [tab.graylogQuery]);

  useEffect(() => {
    if (!connId || !ready) return;
    graylogAPI.streams(connId, scope).then((r) => setStreams((r.data as Stream[]) ?? [])).catch(() => setStreams([]));
  }, [connId, scope, ready]);

  const params = useCallback((offset: number) => ({
    query: (tab.graylogQuery ?? '').trim() || '*', range, streams: selected, limit: PAGE, offset, noHistogram: offset > 0,
  }), [tab.graylogQuery, range, selected]);

  const run = useCallback(async () => {
    if (!connId || !ready) return;
    const my = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await graylogAPI.search(connId, params(0), scope);
      if (my !== seq.current) return;
      setResult(res.data as SearchResult);
      setOpen({});
    } catch (e) {
      if (my !== seq.current) return;
      setError(graylogErr(e, t('search.failed')));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [connId, scope, ready, params, t]);

  // Search whenever the query / range / streams in the tab change.
  useEffect(() => { void run(); }, [run]);

  const loadMore = async () => {
    if (!result) return;
    setLoadingMore(true);
    try {
      // Page within the window the first page searched: a relative range
      // would slide with the clock and repeat or skip messages.
      const page = params(result.messages.length);
      if (result.from && result.to) page.range = { type: 'absolute', from: result.from, to: result.to };
      const res = await graylogAPI.search(connId, page, scope);
      const more = (res.data as SearchResult).messages ?? [];
      setResult((r) => (r ? { ...r, messages: [...r.messages, ...more] } : r));
    } catch (e) {
      setError(graylogErr(e, t('search.failed')));
    }
    setLoadingMore(false);
  };

  const submit = () => {
    if (draft === (tab.graylogQuery ?? '')) void run();
    else updateTab(tab.id, { graylogQuery: draft });
  };
  const addTerm = (field: string, value: unknown) => {
    const v = String(value).replace(/(["\\])/g, '\\$1');
    const term = `${field}:"${v}"`;
    const base = draft.trim();
    updateTab(tab.id, { graylogQuery: !base || base === '*' ? term : `${base} AND ${term}` });
  };
  const zoomTo = (b: Bucket) => {
    const step = intervalMs(result?.interval);
    if (!step) return;
    const from = new Date(b.time);
    updateTab(tab.id, { graylogRange: { type: 'absolute', from: from.toISOString(), to: new Date(from.getTime() + step).toISOString() } });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 border-b p-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={t('search.placeholder')}
            className="h-8 pl-8 font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <RangePicker value={range} onChange={(r) => updateTab(tab.id, { graylogRange: r })} />
        <StreamPicker streams={streams} selected={selected} onChange={(ids) => updateTab(tab.id, { graylogStreams: ids })} />
        <Button size="sm" className="h-8 gap-1.5" onClick={submit} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{t('search.run')}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void run()} title={t('search.refresh')}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
        {result?.webUrl && (
          <a href={result.webUrl} target="_blank" rel="noreferrer" className="h-8 px-2 inline-flex items-center gap-1 rounded border text-xs hover:bg-accent/50" title={t('search.openInGraylog')}>
            <ExternalLink className="h-3.5 w-3.5" />Graylog
          </a>
        )}
      </div>

      {error && (
        <div className="shrink-0 m-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="break-words min-w-0">{error}</span>
        </div>
      )}

      {result && (
        <div className="shrink-0 px-3 pt-2">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="font-semibold tabular-nums">{t('search.total', { count: result.total, formatted: result.total.toLocaleString() })}</span>
            {result.from && <span className="text-muted-foreground">{fmtTime(result.from)} – {fmtTime(result.to)}</span>}
            {result.tookMs != null && <span className="text-muted-foreground">· {t('search.took', { ms: result.tookMs })}</span>}
          </div>
          {(result.histogram?.length ?? 0) > 0 && <Histogram buckets={result.histogram!} interval={result.interval} onPick={zoomTo} />}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {!result && loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : result && result.messages.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">{t('search.noMessages')}</p>
        ) : result && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-5" />
                <th className="px-2 py-1.5 font-medium w-[170px]">{t('search.colTime')}</th>
                <th className="px-2 py-1.5 font-medium w-[180px]">{t('search.colSource')}</th>
                <th className="px-2 py-1.5 font-medium">{t('search.colMessage')}</th>
              </tr>
            </thead>
            <tbody>
              {result.messages.map((m, i) => {
                const key = `${m.id}:${i}`;
                const isOpen = !!open[key];
                return (
                  <Fragment key={key}>
                    <tr className={cn('border-b align-top cursor-pointer hover:bg-accent/30', isOpen && 'bg-accent/20')} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                      <td className="pl-2 pt-1.5 text-muted-foreground">{isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                      <td className="px-2 py-1 font-mono tabular-nums whitespace-nowrap text-muted-foreground">{fmtTime(m.timestamp)}</td>
                      <td className="px-2 py-1 truncate max-w-[180px]" title={m.source}>{m.source}</td>
                      <td className={cn('px-2 py-1 font-mono break-all', !isOpen && 'line-clamp-2')}>{m.message}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-muted/20">
                        <td />
                        <td colSpan={3} className="px-2 py-2"><MessageFields message={m} onAdd={addTerm} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {result && result.messages.length < result.total && result.messages.length > 0 && (
          <div className="flex justify-center p-3">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {t('search.loadMore', { shown: result.messages.length.toLocaleString(), total: result.total.toLocaleString() })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageFields({ message, onAdd }: { message: Message; onAdd: (field: string, value: unknown) => void }) {
  const { t } = useTranslation('graylog');
  const { toast } = useToast();
  const rows: Array<[string, unknown]> = [
    ['timestamp', message.timestamp], ['source', message.source ?? ''], ['message', message.message],
    ...Object.entries(message.fields).filter(([k]) => k !== 'streams').sort(([a], [b]) => a.localeCompare(b)),
  ];
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast({ title: t('search.copied') }));
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono">{message.id}</span>
        {message.index && <span>· {message.index}</span>}
        <button type="button" className="ml-auto inline-flex items-center gap-1 hover:text-foreground" onClick={() => copy(JSON.stringify(Object.fromEntries(rows), null, 2))}>
          <Copy className="h-3 w-3" />{t('search.copyJson')}
        </button>
      </div>
      <div className="grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => {
          const text = typeof v === 'string' ? v : JSON.stringify(v);
          return (
            <Fragment key={k}>
              <span className="font-mono text-muted-foreground truncate" title={k}>{k}</span>
              <span className="group flex items-start gap-1 min-w-0">
                <span className="font-mono break-all whitespace-pre-wrap">{text}</span>
                {k !== 'timestamp' && k !== 'message' && (
                  <button type="button" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0" title={t('search.addToQuery')} onClick={() => onAdd(k, v)}>
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Histogram({ buckets, interval, onPick }: { buckets: Bucket[]; interval?: string; onPick: (b: Bucket) => void }) {
  const { t } = useTranslation('graylog');
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="mt-2 mb-2">
      <div className="flex items-end gap-px h-16 border-b border-border/60" role="img" aria-label={t('search.histogramAria', { count: buckets.length, interval: interval ?? '' })}>
        {buckets.map((b) => (
          <button
            key={b.time}
            type="button"
            onClick={() => onPick(b)}
            className="flex-1 min-w-[2px] rounded-t-sm bg-rose-500/70 hover:bg-rose-500 transition-colors"
            style={{ height: `${Math.max(b.count ? 4 : 0, (b.count / max) * 100)}%` }}
            title={t('search.bucket', { time: fmtTime(b.time), count: b.count, interval: interval ?? '' })}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
        <span>{fmtTime(buckets[0].time)}</span>
        <span>{t('search.perInterval', { interval: interval ?? '' })}</span>
        <span>{fmtTime(buckets[buckets.length - 1].time)}</span>
      </div>
    </div>
  );
}

function RangePicker({ value, onChange }: { value: GraylogRange; onChange: (r: GraylogRange) => void }) {
  const { t } = useTranslation('graylog');
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setFrom(toLocalInput(value.type === 'absolute' && value.from ? new Date(value.from) : new Date(now.getTime() - (value.range ?? 900) * 1000)));
    setTo(toLocalInput(value.type === 'absolute' && value.to ? new Date(value.to) : now));
  }, [open, value]);
  const label = value.type === 'absolute'
    ? `${fmtTime(value.from)} – ${fmtTime(value.to)}`
    : value.type === 'keyword' ? (value.keyword ?? '') : t('range.last', { span: fmtSpan(value.range ?? 900, t) });
  const apply = () => {
    const f = new Date(from);
    const tt = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(tt.getTime()) || tt <= f) return;
    onChange({ type: 'absolute', from: f.toISOString(), to: tt.toISOString() });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs max-w-[260px]"><span className="truncate">{label}</span><ChevronDown className="h-3.5 w-3.5 ml-1 shrink-0" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('range.relative')}</div>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((s) => (
            <Button key={s} size="sm" variant={value.type === 'relative' && value.range === s ? 'secondary' : 'ghost'} className="h-7 text-xs"
              onClick={() => { onChange({ type: 'relative', range: s }); setOpen(false); }}>
              {fmtSpan(s, t)}
            </Button>
          ))}
        </div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground pt-1">{t('range.absolute')}</div>
        <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs" aria-label={t('range.from')} />
        <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs" aria-label={t('range.to')} />
        <Button size="sm" className="h-7 w-full text-xs" onClick={apply}>{t('range.apply')}</Button>
      </PopoverContent>
    </Popover>
  );
}

function StreamPicker({ streams, selected, onChange }: { streams: Stream[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation('graylog');
  const [q, setQ] = useState('');
  const label = selected.length === 0
    ? t('streams.all')
    : selected.length === 1 ? (streams.find((s) => s.id === selected[0])?.title ?? t('streams.count', { count: 1 })) : t('streams.count', { count: selected.length });
  const shown = streams.filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 max-w-[220px]">
          <Waves className="h-3.5 w-3.5 text-violet-500 shrink-0" /><span className="truncate">{label}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-1.5">
        {streams.length > 8 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('streams.filter')} className="h-7 text-xs" />}
        <button type="button" onClick={() => onChange([])} className={cn('w-full text-left px-2 py-1 rounded text-xs hover:bg-accent/50', selected.length === 0 && 'font-medium')}>
          {t('streams.all')}
        </button>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {shown.map((s) => (
            <label key={s.id} className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-accent/50 cursor-pointer" title={s.description || s.title}>
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              <span className={cn('truncate', s.disabled && 'text-muted-foreground')}>{s.title}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Dashboards & saved searches ─────────────────────────────────────────

function DashboardsView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('graylog');
  const { connId, scope, ready } = useConn(tab);
  const [views, setViews] = useState<View[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'dashboard' | 'search'>('all');
  const load = useCallback(async () => {
    if (!connId || !ready) return;
    setError('');
    try {
      const res = await graylogAPI.views(connId, undefined, scope);
      setViews((res.data as View[]) ?? []);
    } catch (e) {
      setError(graylogErr(e, t('dashboards.failed')));
    }
  }, [connId, scope, ready, t]);
  useEffect(() => { void load(); }, [load]);
  const shown = (views ?? []).filter((v) => (kind === 'all' || v.type === kind) && (!q || `${v.title} ${v.summary ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 border-b p-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dashboards.filter')} className="h-8 pl-8 text-xs" />
        </div>
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">{t('dashboards.kindAll')}</SelectItem>
            <SelectItem value="dashboard" className="text-xs">{t('dashboards.kindDashboard')}</SelectItem>
            <SelectItem value="search" className="text-xs">{t('dashboards.kindSearch')}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void load()} title={t('search.refresh')}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="shrink-0 px-3 pt-2 text-[11px] text-muted-foreground">{t('dashboards.hint')}</p>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {error ? (
          <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>
        ) : views === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">{t('dashboards.empty')}</p>
        ) : shown.map((v) => (
          <a key={`${v.type}:${v.id}`} href={v.webUrl} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded border px-3 py-2 hover:bg-accent/40">
            {v.type === 'dashboard' ? <LayoutDashboard className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" /> : <Search className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{v.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{v.type === 'dashboard' ? t('dashboards.kindDashboardOne') : t('dashboards.kindSearchOne')}</span>
              </div>
              {(v.summary || v.description) && <p className="text-xs text-muted-foreground line-clamp-2">{v.summary || v.description}</p>}
              {v.updatedAt && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t('dashboards.updated', { time: fmtTime(v.updatedAt) })}</p>}
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtSpan(sec: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (sec % 86400 === 0) return t('range.days', { count: sec / 86400 });
  if (sec % 3600 === 0) return t('range.hours', { count: sec / 3600 });
  return t('range.minutes', { count: Math.round(sec / 60) });
}

/** Histogram bucket length in ms ("30s", "5m", "1h", "1d" …). */
function intervalMs(iv?: string): number {
  const m = /^(\d+)([smhd])$/.exec(iv ?? '');
  if (!m) return 0;
  return Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

class GraylogBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportCrash({
      source: 'boundary',
      message: `[graylog] ${error.message}`,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }
  render() {
    if (this.state.error) return <TabError message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('graylog');
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
        <div className="text-sm font-medium">{t('renderError')}</div>
        <div className="text-xs text-muted-foreground break-words font-mono">{message}</div>
        <Button size="sm" variant="outline" onClick={onRetry}>{t('common:retry')}</Button>
      </div>
    </div>
  );
}
