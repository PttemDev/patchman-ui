import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, Columns3, Copy, Loader2, Plus, RefreshCw, Search, SquareTerminal, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { reportCrash } from '@/lib/errorReporter';
import { cn } from '@/lib/utils';
import { esAPI, type DBScope } from '@/services/api';
import { useESConnectionStore, scopeForEs } from '@/stores/esConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import type {
  ESDataView, ESDataViewHit, ESDataViewSearchResult, Field, GraylogRange, Tab,
} from '@/types';
import { consoleText, fieldText, hitFields, luceneTerm } from './esRow';

// Main-pane body of an ES tab that carries esDataViewId (lazy-loaded by
// TabBody): a Kibana Discover-style search over one data view. The data
// view's time field drives the range filter, sort and histogram; paging uses
// the PIT + search_after the BE returns. Own error boundary.
export default function ESDiscoverPanel({ tab }: { tab: Tab }) {
  return (
    <DiscoverBoundary key={`${tab.esConnectionId}:${tab.esDataViewId}`}>
      <DiscoverView tab={tab} />
    </DiscoverBoundary>
  );
}

const PAGE = 100;
const DEFAULT_RANGE: GraylogRange = { type: 'relative', range: 900 };
const PRESETS = [300, 900, 3600, 4 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 30 * 86400];

interface TimeWindow { from: string; to: string }

function resolveRange(r: GraylogRange): TimeWindow {
  if (r.type === 'absolute' && r.from && r.to) return { from: r.from, to: r.to };
  const now = Date.now();
  return { from: new Date(now - (r.range ?? 900) * 1000).toISOString(), to: new Date(now).toISOString() };
}

function errText(e: unknown, fallback: string): string {
  const x = e as { response?: { data?: { error?: string } }; message?: string };
  return x?.response?.data?.error || x?.message || fallback;
}

function DiscoverView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('es');
  const { toast } = useToast();
  const updateTab = useRequestStore((s) => s.updateTab);
  const addTab = useRequestStore((s) => s.addTab);
  const connections = useESConnectionStore((s) => s.connections);
  const loaded = useESConnectionStore((s) => s.loaded);
  const fetchConnections = useESConnectionStore((s) => s.fetchConnections);
  useEffect(() => { if (!loaded) void fetchConnections(); }, [loaded, fetchConnections]);

  const connId = tab.esConnectionId ?? '';
  const dvId = tab.esDataViewId ?? '';
  const space = tab.esDataViewSpace;
  const tenant = tab.esDataViewTenant;
  const conn = connections.find((c) => c.id === connId);
  const scope: DBScope | undefined = loaded ? (tab.esExecScope ?? scopeForEs(connections, connId)) : undefined;
  const ready = loaded && !!connId && !!dvId;

  const range = tab.esDiscoverRange ?? DEFAULT_RANGE;
  const columns = useMemo(() => tab.esDiscoverColumns ?? [], [tab.esDiscoverColumns]);
  const [draft, setDraft] = useState(tab.esDiscoverQuery ?? '');
  const [dv, setDv] = useState<ESDataView | null>(null);
  const [result, setResult] = useState<ESDataViewSearchResult | null>(null);
  const [win, setWin] = useState<TimeWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const seq = useRef(0);

  useEffect(() => { setDraft(tab.esDiscoverQuery ?? ''); }, [tab.esDiscoverQuery]);

  // Data view detail (time field + runtime fields) for the header.
  useEffect(() => {
    if (!ready) return;
    esAPI.dataView(connId, dvId, space, scope, tenant)
      .then((r) => setDv(r.data as ESDataView))
      .catch((e) => setError(errText(e, t('discover.failed'))));
  }, [ready, connId, dvId, space, tenant, scope, t]);

  const run = useCallback(async () => {
    if (!ready) return;
    const my = ++seq.current;
    const w = resolveRange(range);
    setLoading(true);
    setError('');
    try {
      const res = await esAPI.dataViewSearch(connId, dvId, {
        space, tenant, from: w.from, to: w.to, query: tab.esDiscoverQuery ?? '', size: PAGE, histogram: true,
      }, scope);
      if (my !== seq.current) return;
      const data = res.data as ESDataViewSearchResult;
      setResult(data);
      setDv((d) => d ?? data.dataView);
      setWin(w);
      setOpen({});
    } catch (e) {
      if (my !== seq.current) return;
      setError(errText(e, t('discover.failed')));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [ready, range, connId, dvId, space, tenant, tab.esDiscoverQuery, scope, t]);

  useEffect(() => { void run(); }, [run]);

  const loadMore = async () => {
    if (!result || !win || result.hits.length === 0) return;
    const last = result.hits[result.hits.length - 1];
    if (!last.sort) return;
    const my = seq.current;
    setLoadingMore(true);
    try {
      const res = await esAPI.dataViewSearch(connId, dvId, {
        space, tenant, from: win.from, to: win.to, query: tab.esDiscoverQuery ?? '', size: PAGE,
        searchAfter: last.sort, pitId: result.pitId,
      }, scope);
      if (my !== seq.current) return;
      const more = res.data as ESDataViewSearchResult;
      setResult((r) => (r ? { ...r, hits: [...r.hits, ...more.hits], pitId: more.pitId || r.pitId, hasMore: more.hasMore } : r));
    } catch (e) {
      setError(errText(e, t('discover.failed')));
    }
    setLoadingMore(false);
  };

  const submit = () => {
    if (draft === (tab.esDiscoverQuery ?? '')) void run();
    else updateTab(tab.id, { esDiscoverQuery: draft });
  };
  const addTerm = (field: string, value: unknown) => {
    const term = luceneTerm(field, value);
    const base = draft.trim();
    updateTab(tab.id, { esDiscoverQuery: !base || base === '*' ? term : `${base} AND ${term}` });
  };
  const toggleColumn = (field: string) => {
    updateTab(tab.id, { esDiscoverColumns: columns.includes(field) ? columns.filter((c) => c !== field) : [...columns, field] });
  };
  const zoomTo = (key: number) => {
    const step = intervalMs(result?.interval);
    if (!step) return;
    updateTab(tab.id, { esDiscoverRange: { type: 'absolute', from: new Date(key).toISOString(), to: new Date(key + step).toISOString() } });
  };
  const openInConsole = async () => {
    if (!ready) return;
    const w = win ?? resolveRange(range);
    try {
      const res = await esAPI.dataViewSearch(connId, dvId, {
        space, tenant, from: w.from, to: w.to, query: tab.esDiscoverQuery ?? '', size: PAGE, histogram: true, dryRun: true,
      }, scope);
      const q = (res.data as ESDataViewSearchResult).query;
      addTab({
        type: 'es', name: `ES · ${conn?.name ?? tab.esDataViewName ?? ''}`, method: 'GET', url: '',
        esConnectionId: connId, esExecScope: tab.esExecScope, esIndex: dv?.pattern, esQuery: consoleText(q),
      }, true);
    } catch (e) {
      toast({ title: errText(e, t('discover.failed')), variant: 'destructive' });
    }
  };

  const timeField = dv?.timeField || result?.dataView.timeField || '';
  const runtimeCount = Object.keys(dv?.runtimeFields ?? {}).length;
  const total = result?.total ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Data view header */}
      <div className="shrink-0 px-3 pt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold truncate max-w-[40%]" title={tab.esDataViewName}>{dv?.name ?? tab.esDataViewName}</span>
        {dv && <span className="font-mono text-muted-foreground truncate max-w-[40%]" title={dv.pattern}>{dv.pattern}</span>}
        {timeField ? (
          <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0"><Clock className="h-3 w-3" />{timeField}</Badge>
        ) : dv && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-600">{t('discover.noTimeField')}</Badge>
        )}
        {runtimeCount > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{t('discover.runtimeFields', { count: runtimeCount })}</Badge>}
        {conn && <span className="ml-auto text-muted-foreground truncate">{conn.name}{space ? ` · ${space}` : ''}{tenant ? ` · ${tenant === 'global' ? t('sidebar.tenantGlobal') : tenant === 'private' ? t('sidebar.tenantPrivate') : tenant}` : ''}</span>}
      </div>

      {/* Query bar */}
      <div className="shrink-0 border-b p-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={t('discover.placeholder')}
            className="h-8 pl-8 font-mono text-xs"
            spellCheck={false}
          />
        </div>
        {timeField && <RangePicker value={range} onChange={(r) => updateTab(tab.id, { esDiscoverRange: r })} />}
        <ColumnPicker connId={connId} scope={scope} dv={dv} columns={columns} onToggle={toggleColumn} onReset={() => updateTab(tab.id, { esDiscoverColumns: [] })} />
        <Button size="sm" className="h-8 gap-1.5" onClick={submit} disabled={loading || !ready}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{t('discover.run')}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void run()} title={t('discover.refresh')}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void openInConsole()} title={t('discover.openInConsole')} disabled={!ready}>
          <SquareTerminal className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && (
        <div className="shrink-0 m-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="break-words min-w-0 whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {result && (
        <div className="shrink-0 px-3 pt-2">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="font-semibold tabular-nums">
              {result.totalRelation === 'gte'
                ? t('discover.totalGte', { formatted: total.toLocaleString() })
                : t('discover.total', { count: total, formatted: total.toLocaleString() })}
            </span>
            {timeField && win && <span className="text-muted-foreground">{fmtTime(win.from)} – {fmtTime(win.to)}</span>}
            {result.tookMs != null && <span className="text-muted-foreground">· {t('discover.took', { ms: result.tookMs })}</span>}
          </div>
          {(result.buckets?.length ?? 0) > 0 && <Histogram buckets={result.buckets!} interval={result.interval} onPick={zoomTo} />}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {!result && (loading || !ready) ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : result && result.hits.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">{t('discover.noHits')}</p>
        ) : result && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-5" />
                {timeField && <th className="px-2 py-1.5 font-medium w-[190px] whitespace-nowrap">{timeField}</th>}
                {columns.length === 0 ? (
                  <th className="px-2 py-1.5 font-medium">{t('discover.documentCol')}</th>
                ) : columns.map((c) => (
                  <th key={c} className="px-2 py-1.5 font-medium normal-case tracking-normal font-mono">
                    <span className="inline-flex items-center gap-1 group">
                      {c}
                      <button type="button" className="opacity-0 group-hover:opacity-100 hover:text-foreground" title={t('discover.removeColumn')} onClick={() => toggleColumn(c)}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.hits.map((h, i) => {
                const key = `${h._index}/${h._id}:${i}`;
                const isOpen = !!open[key];
                const flat = hitFields(h);
                const span = 1 + (timeField ? 1 : 0) + Math.max(1, columns.length);
                return (
                  <Fragment key={key}>
                    <tr className={cn('border-b align-top cursor-pointer hover:bg-accent/30', isOpen && 'bg-accent/20')} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                      <td className="pl-2 pt-1.5 text-muted-foreground">{isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                      {timeField && <td className="px-2 py-1 font-mono tabular-nums whitespace-nowrap text-muted-foreground">{fmtTime(fieldText(flat[timeField]))}</td>}
                      {columns.length === 0 ? (
                        <td className={cn('px-2 py-1 break-all', !isOpen && 'line-clamp-3')}><DocSummary flat={flat} skip={timeField} /></td>
                      ) : columns.map((c) => (
                        <td key={c} className={cn('px-2 py-1 font-mono break-all', !isOpen && 'line-clamp-2')}>{fieldText(flat[c])}</td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-muted/20">
                        <td />
                        <td colSpan={span - 1} className="px-2 py-2">
                          <HitFields hit={h} flat={flat} columns={columns} onAdd={addTerm} onToggleColumn={toggleColumn} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {result && result.hasMore && result.hits.length > 0 && (
          <div className="flex justify-center p-3">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {t('discover.loadMore', { shown: result.hits.length.toLocaleString(), total: total.toLocaleString() })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Kibana-like document summary: "key: value" pairs, keys highlighted.
function DocSummary({ flat, skip }: { flat: Record<string, unknown>; skip: string }) {
  const entries = Object.entries(flat).filter(([k]) => k !== skip).slice(0, 40);
  return (
    <span className="font-mono">
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2">
          <span className="rounded bg-muted px-1 text-muted-foreground">{k}</span>{' '}
          <span>{fieldText(v)}</span>
        </span>
      ))}
    </span>
  );
}

function HitFields({ hit, flat, columns, onAdd, onToggleColumn }: {
  hit: ESDataViewHit; flat: Record<string, unknown>; columns: string[];
  onAdd: (field: string, value: unknown) => void; onToggleColumn: (field: string) => void;
}) {
  const { t } = useTranslation('es');
  const { toast } = useToast();
  const rows = Object.entries(flat).sort(([a], [b]) => a.localeCompare(b));
  const copy = () => void navigator.clipboard.writeText(JSON.stringify(hit, null, 2)).then(() => toast({ title: t('discover.copied') }));
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono">{hit._id}</span>
        <span>· {hit._index}</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 hover:text-foreground" onClick={copy}>
          <Copy className="h-3 w-3" />{t('discover.copyJson')}
        </button>
      </div>
      <div className="grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <span className="font-mono text-muted-foreground truncate" title={k}>{k}</span>
            <span className="group flex items-start gap-1 min-w-0">
              <span className="font-mono break-all whitespace-pre-wrap">{fieldText(v)}</span>
              <button type="button" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0" title={t('discover.addToQuery')} onClick={() => onAdd(k, v)}>
                <Plus className="h-3 w-3" />
              </button>
              <button type="button" className={cn('opacity-0 group-hover:opacity-100 hover:text-foreground shrink-0', columns.includes(k) ? 'text-primary opacity-100' : 'text-muted-foreground')} title={t('discover.toggleColumn')} onClick={() => onToggleColumn(k)}>
                <Columns3 className="h-3 w-3" />
              </button>
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ColumnPicker({ connId, scope, dv, columns, onToggle, onReset }: {
  connId: string; scope: DBScope | undefined; dv: ESDataView | null; columns: string[];
  onToggle: (f: string) => void; onReset: () => void;
}) {
  const { t } = useTranslation('es');
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<string[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open || fields !== null || !dv?.pattern || !scope) return;
    esAPI.mapping(connId, dv.pattern, scope)
      .then((r) => {
        const names = new Set(((r.data as Field[]) ?? []).map((f) => f.path).filter((p) => !p.startsWith('_')));
        Object.keys(dv.runtimeFields ?? {}).forEach((n) => names.add(n));
        setFields(Array.from(names).sort());
      })
      .catch(() => setFields(Object.keys(dv.runtimeFields ?? {}).sort()));
  }, [open, fields, dv, connId, scope]);
  const shown = (fields ?? []).filter((f) => !q || f.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />{t('discover.columns')}{columns.length > 0 && <span className="text-muted-foreground">· {columns.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('discover.columnsFilter')} className="h-7 text-xs" />
        {columns.length > 0 && (
          <button type="button" onClick={onReset} className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent/50 text-muted-foreground">
            {t('discover.resetColumns')}
          </button>
        )}
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {fields === null ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : shown.map((f) => (
            <label key={f} className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-accent/50 cursor-pointer">
              <input type="checkbox" checked={columns.includes(f)} onChange={() => onToggle(f)} />
              <span className="font-mono truncate" title={f}>{f}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Histogram({ buckets, interval, onPick }: {
  buckets: Array<{ key: number; keyAsString?: string; count: number }>; interval?: string; onPick: (key: number) => void;
}) {
  const { t } = useTranslation('es');
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const first = new Date(buckets[0].key).toISOString();
  const last = new Date(buckets[buckets.length - 1].key).toISOString();
  return (
    <div className="mt-2 mb-2">
      <div className="flex items-end gap-px h-16 border-b border-border/60" role="img" aria-label={t('discover.histogramAria', { count: buckets.length, interval: interval ?? '' })}>
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => onPick(b.key)}
            className="flex-1 min-w-[2px] rounded-t-sm bg-yellow-500/70 hover:bg-yellow-500 transition-colors"
            style={{ height: `${Math.max(b.count ? 4 : 0, (b.count / max) * 100)}%` }}
            title={t('discover.bucket', { time: fmtTime(new Date(b.key).toISOString()), count: b.count })}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
        <span>{fmtTime(first)}</span>
        {interval && <span>{t('discover.perInterval', { interval })}</span>}
        <span>{fmtTime(last)}</span>
      </div>
    </div>
  );
}

function RangePicker({ value, onChange }: { value: GraylogRange; onChange: (r: GraylogRange) => void }) {
  const { t } = useTranslation('es');
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
    : t('discover.range.last', { span: fmtSpan(value.range ?? 900, t) });
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
        <Button size="sm" variant="outline" className="h-8 text-xs max-w-[260px]">
          <Clock className="h-3.5 w-3.5 mr-1 shrink-0" /><span className="truncate">{label}</span><ChevronDown className="h-3.5 w-3.5 ml-1 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('discover.range.relative')}</div>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((s) => (
            <Button key={s} size="sm" variant={value.type === 'relative' && value.range === s ? 'secondary' : 'ghost'} className="h-7 text-xs"
              onClick={() => { onChange({ type: 'relative', range: s }); setOpen(false); }}>
              {fmtSpan(s, t)}
            </Button>
          ))}
        </div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground pt-1">{t('discover.range.absolute')}</div>
        <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs" aria-label={t('discover.range.from')} />
        <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs" aria-label={t('discover.range.to')} />
        <Button size="sm" className="h-7 w-full text-xs" onClick={apply}>{t('discover.range.apply')}</Button>
      </PopoverContent>
    </Popover>
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
  if (sec % 86400 === 0) return t('discover.range.days', { count: sec / 86400 });
  if (sec % 3600 === 0) return t('discover.range.hours', { count: sec / 3600 });
  return t('discover.range.minutes', { count: Math.round(sec / 60) });
}

/** auto_date_histogram interval ("30s", "5m", "3h", "1d", "7d") in ms; 0 for
 *  calendar units (M / y) that have no fixed length. */
function intervalMs(iv?: string): number {
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(iv ?? '');
  if (!m) return 0;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] as 'ms' | 's' | 'm' | 'h' | 'd'];
}

class DiscoverBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportCrash({
      source: 'boundary',
      message: `[es-discover] ${error.message}`,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }
  render() {
    if (this.state.error) return <DiscoverError message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function DiscoverError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('es');
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
        <div className="text-sm font-medium">{t('discover.renderError')}</div>
        <div className="text-xs text-muted-foreground break-words font-mono">{message}</div>
        <Button size="sm" variant="outline" onClick={onRetry}>{t('common:retry')}</Button>
      </div>
    </div>
  );
}
