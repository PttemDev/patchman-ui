import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AxiosResponse } from 'axios';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, Info, Loader2, MoreVertical, RefreshCw, Code2, Shuffle, Maximize2, Terminal, Spline } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { grafanaAPI, type DBScope } from '@/services/api';
import { grafanaError } from '@/stores/grafanaConnectionStore';
import { cn } from '@/lib/utils';
import type { GrafanaFrame, GrafanaPanel, GrafanaQueryResult, GrafanaVarValue } from '@/types';
import { PanelViz, SUPPORTED, UnsupportedViz } from './PanelViz';
import { QueryInspector } from '../QueryInspector';

// One dashboard panel: chrome (title, info, errors, menu) + data. Queries run
// once the panel scrolls into view and through a small concurrency gate, so a
// 60-panel dashboard doesn't fire 60 requests at once.

const MAX_PARALLEL = 6;
let running = 0;
const waiting: Array<() => void> = [];

async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export interface PanelContext {
  connId: string;
  scope: DBScope;
  from: string;
  to: string;
  vars: Record<string, GrafanaVarValue>;
  /** Bumped by refresh / auto-refresh. */
  tick: number;
  /** Grafana link for the panel ("view panel"). */
  linkFor: (panelId?: number) => string;
  interpolate: (s: string) => string;
  onZoom: (from: number, to: number) => void;
  /** Show one panel full size (Grafana "View"); omitted in that view. */
  onView?: (panel: GrafanaPanel) => void;
  /** recharts syncId when the dashboard shares crosshair/tooltip. */
  syncId?: string;
  connName?: string;
  /** Public dashboard: panels are queried by id through the public API. */
  publicToken?: string;
  /** Open a panel link (Grafana dashboard links open as PatchMan tabs). */
  openLink?: (url: string) => void;
}

export function PanelView({ panel, ctx, height }: { panel: GrafanaPanel; ctx: PanelContext; height: number }) {
  const { t } = useTranslation('grafana');
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [frames, setFrames] = useState<GrafanaFrame[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [timeRange, setTimeRange] = useState<[number, number] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [localTick, setLocalTick] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  // Viewer-only override of "Connect null values" (never saved to Grafana).
  const [connectGaps, setConnectGaps] = useState<boolean | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const supported = SUPPORTED.has(panel.type);
  const needsData = supported && panel.type !== 'text';
  const targets = useMemo(() => (panel.targets ?? []).filter((tg) => !tg.hide), [panel.targets]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const run = useCallback(async () => {
    if (!needsData || (targets.length === 0 && !ctx.publicToken) || (ctx.publicToken && panel.id == null)) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const width = ref.current?.clientWidth ?? 800;
      const maxDataPoints = Math.max(100, Math.min(2000, Number(panel.maxDataPoints) || width));
      const res = await gate((): Promise<AxiosResponse> => (ctx.publicToken
        ? grafanaAPI.publicPanelQuery(ctx.connId, ctx.publicToken, panel.id!, { from: ctx.from, to: ctx.to, maxDataPoints }, ctx.scope, ac.signal)
        : grafanaAPI.query(ctx.connId, {
          from: ctx.from,
          to: ctx.to,
          targets,
          panelDatasource: panel.datasource,
          vars: ctx.vars,
          maxDataPoints,
          minInterval: panel.interval,
        }, ctx.scope, ac.signal)));
      if (ac.signal.aborted) return;
      const data = res.data as GrafanaQueryResult;
      const all: GrafanaFrame[] = [];
      const errs: string[] = [];
      let note = '';
      for (const [ref, r] of Object.entries(data.results ?? {})) {
        all.push(...(r.frames ?? []).filter(Boolean));
        if (r.error) errs.push(Object.keys(data.results).length > 1 ? `${ref}: ${r.error}` : r.error);
        if (r.notice) note = r.notice;
      }
      setFrames(all);
      setErrors(errs);
      setNotice(note);
      // A public dashboard may ignore the requested range (time selection
      // off in its share settings) — let the chart fit the data instead.
      if (data.from && data.to && !ctx.publicToken) setTimeRange([data.from, data.to]);
    } catch (e) {
      if (ac.signal.aborted) return;
      setErrors([grafanaError(e).message]);
      setFrames([]);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [needsData, targets, ctx.connId, ctx.from, ctx.to, ctx.vars, ctx.scope, ctx.publicToken, panel.id, panel.datasource, panel.maxDataPoints, panel.interval]);

  useEffect(() => {
    if (visible) void run();
    return () => abortRef.current?.abort();
  }, [visible, run, ctx.tick, localTick]);

  const isSeries = panel.type === 'timeseries' || panel.type === 'graph';
  const viewPanel = useMemo(() => {
    if (connectGaps === undefined) return panel;
    const fc = panel.fieldConfig ?? {};
    const defaults = (fc.defaults ?? {}) as Record<string, unknown>;
    return {
      ...panel,
      nullPointMode: connectGaps ? 'connected' : 'null',
      fieldConfig: { ...fc, defaults: { ...defaults, custom: { ...((defaults.custom as object) ?? {}), spanNulls: connectGaps } } },
    } as GrafanaPanel;
  }, [panel, connectGaps]);
  const gapsOn = connectGaps ?? (panel.type === 'graph' ? panel.nullPointMode === 'connected' : (panel.fieldConfig?.defaults?.custom as { spanNulls?: unknown } | undefined)?.spanNulls === true);

  const title = ctx.interpolate(panel.title ?? '');
  const link = ctx.linkFor(panel.id);
  // Public dashboards strip the queries: nothing to inspect or copy.
  const canInspect = needsData && targets.length > 0 && !ctx.publicToken;
  const hasTransforms = Array.isArray(panel.transformations) && panel.transformations.length > 0;

  return (
    <div ref={ref} className="h-full flex flex-col rounded-md border bg-card overflow-hidden group/panel" style={{ height }}>
      <div className="flex items-center gap-1.5 px-2 h-7 shrink-0">
        <span className="text-xs font-medium truncate" title={title}>{title}</span>
        {panel.description && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground"><Info className="h-3 w-3" /></button>
            </PopoverTrigger>
            <PopoverContent className="text-xs max-w-xs whitespace-pre-wrap">{ctx.interpolate(String(panel.description))}</PopoverContent>
          </Popover>
        )}
        {errors.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="text-destructive"><AlertTriangle className="h-3 w-3" /></button>
            </PopoverTrigger>
            <PopoverContent className="text-xs max-w-sm break-words space-y-1">
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </PopoverContent>
          </Popover>
        )}
        {hasTransforms && (
          <span title={t('panel.transformationsIgnored')} className="text-amber-500"><Shuffle className="h-3 w-3" /></span>
        )}
        {notice && <span className="text-[9px] text-muted-foreground/70 truncate">{notice}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {canInspect && (
            <button type="button" onClick={() => setInspecting(true)} title={t('panel.inspect')} className="p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover/panel:opacity-100">
              <Terminal className="h-3.5 w-3.5" />
            </button>
          )}
          {ctx.onView && (
            <button type="button" onClick={() => ctx.onView?.(panel)} title={t('panel.view')} className="p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover/panel:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover/panel:opacity-100 data-[state=open]:opacity-100">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {ctx.onView && (
                <DropdownMenuItem onClick={() => ctx.onView?.(panel)}>
                  <Maximize2 className="h-3.5 w-3.5 mr-2" /> {t('panel.view')}
                </DropdownMenuItem>
              )}
              {canInspect && (
                <DropdownMenuItem onClick={() => setInspecting(true)}>
                  <Terminal className="h-3.5 w-3.5 mr-2" /> {t('panel.inspect')}
                </DropdownMenuItem>
              )}
              {needsData && (
                <DropdownMenuItem onClick={() => setLocalTick((n) => n + 1)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> {t('panel.refresh')}
                </DropdownMenuItem>
              )}
              {isSeries && (
                <DropdownMenuItem onClick={() => setConnectGaps(!gapsOn)}>
                  <Spline className="h-3.5 w-3.5 mr-2" /> {gapsOn ? t('panel.showGaps') : t('panel.connectGaps')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {targets.length > 0 && !ctx.publicToken && (
                <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(targets.map((tg) => ctx.interpolate(String(tg.expr ?? tg.rawSql ?? tg.query ?? JSON.stringify(tg)))).join('\n\n'))}>
                  <Code2 className="h-3.5 w-3.5 mr-2" /> {t('panel.copyQuery')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => window.open(link, '_blank', 'noopener')}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" /> {t('panel.openInGrafana')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className={cn('flex-1 min-h-0 px-2 pb-2', loading && frames === null && 'opacity-60')}>
        {!supported ? (
          <UnsupportedViz panel={panel} link={link} />
        ) : !needsData ? (
          <PanelViz panel={panel} frames={[]} interpolate={ctx.interpolate} />
        ) : frames === null ? (
          <div className="h-full" />
        ) : (
          <PanelViz panel={viewPanel} frames={frames} onZoom={ctx.onZoom} interpolate={ctx.interpolate} syncId={ctx.syncId} timeRange={timeRange} onLink={ctx.openLink} />
        )}
      </div>
      {inspecting && (
        <QueryInspector
          open={inspecting}
          onOpenChange={setInspecting}
          connId={ctx.connId}
          connName={ctx.connName}
          scope={ctx.scope}
          panel={panel}
          title={title || t('panel.inspect')}
          from={ctx.from}
          to={ctx.to}
          vars={ctx.vars}
          initial={frames ? { frames, errors, notice, ms: 0, from: timeRange?.[0], to: timeRange?.[1] } : null}
        />
      )}
    </div>
  );
}
