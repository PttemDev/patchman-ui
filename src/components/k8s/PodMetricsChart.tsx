import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Loader2, Cpu, MemoryStick, AlertTriangle, History, Activity } from 'lucide-react';
import { k8sAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type {
  K8sPodMetricsResult, K8sContainerMetrics,
  K8sPodMetricsHistoryResult, K8sPromContainerSeries,
} from '@/types';

// Pod metrics with two tiers:
//   • HISTORY  — real historical CPU/memory from an in-cluster Prometheus,
//     reached through the kube-apiserver service-proxy (like OpenLens). Shown
//     when a Prometheus is discoverable; a range selector (15m/1h/6h/24h) picks
//     the window. No client-side accumulation — Prometheus keeps the history.
//   • LIVE     — the metrics-server snapshot polled every few seconds and
//     accumulated client-side into a rolling buffer. The fallback when no
//     Prometheus is reachable (the original behaviour). Not history: resets on
//     tab/pod change.
// On open we probe for Prometheus once; if found we render HISTORY and never
// start the live poll (the two series would otherwise fight). If absent we run
// the live poll. If the probe errors (RBAC on services/proxy, timeout) we still
// run the live poll but surface the reason so missing proxy rights aren't hidden.

const POLL_MS = 5000;      // live snapshot cadence
const MAX_SAMPLES = 60;    // ~5 min of live history at POLL_MS
const DEFAULT_RANGE = '1h';
const RANGES = ['15m', '1h', '6h', '24h'] as const;
type RangeKey = (typeof RANGES)[number];

// Distinct, theme-safe series hues (match the app's PHASE_COLORS palette);
// axes/grid/tooltip use theme tokens so the chrome tracks light/dark.
const CPU_COLOR = '#3b82f6';  // blue-500
const MEM_COLOR = '#10b981';  // emerald-500

// Unified chart point: t = unix ms, v = millicores (CPU) or bytes (memory).
interface Point {
  t: number;
  v: number;
}

// kubectl-top-style binary memory formatting (Ki/Mi/Gi …), compact significand.
function formatMem(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)}`;
  const units = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s.replace(/\.?0+$/, '')}${units[i]}`;
}

// CPU as kubectl top would: sub-core in millicores ("34m"), otherwise cores.
function formatCpu(milli: number | undefined): string {
  if (milli == null || !Number.isFinite(milli)) return '—';
  if (milli < 1000) return `${Math.round(milli)}m`;
  const cores = milli / 1000;
  return `${(cores >= 10 ? cores.toFixed(1) : cores.toFixed(2)).replace(/\.?0+$/, '')} cores`;
}

// Date-only vs time-of-day tick labels depending on span (history can be 24h).
function fmtClock(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtClockSec(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Local error extractor (K8sExplorerPanel's is module-private); keep it tiny.
function errText(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
    return anyErr.response?.data?.error || anyErr.message || fallback;
  }
  return fallback;
}

// Latest value of a series (last point), or undefined when empty.
function lastVal(series: { val: number }[] | undefined): number | undefined {
  if (!series || series.length === 0) return undefined;
  return series[series.length - 1].val;
}

interface Sample {
  t: number;
  cpuMilli: number;
  memBytes: number;
}

type Mode = 'loading' | 'history' | 'live';

export function PodMetricsChart({
  connId, context, namespace, podName, scope, active,
}: {
  connId: string;
  context: string;
  namespace: string;
  podName: string;
  scope?: DBScope;
  active: boolean;
}) {
  const { t } = useTranslation('k8s');

  const [mode, setMode] = useState<Mode>('loading');

  // ── History (Prometheus) state ──────────────────────────────────────────
  const [hist, setHist] = useState<K8sPodMetricsHistoryResult | null>(null);
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [histLoading, setHistLoading] = useState(false);
  // Populated when the Prometheus probe errored (not merely "absent"): the live
  // poll still runs, but we tell the user why history is missing.
  const [histWarn, setHistWarn] = useState('');

  // ── Live (metrics-server) state ─────────────────────────────────────────
  const [samples, setSamples] = useState<Sample[]>([]);
  const [containers, setContainers] = useState<K8sContainerMetrics[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [fetchedOnce, setFetchedOnce] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Monotonic request ids — a slow earlier response is discarded so it can't
  // land after a newer one. History and live use SEPARATE counters: the live
  // poll must never invalidate an in-flight history probe (that would strand
  // mode at 'loading'), and vice versa.
  const histReqRef = useRef(0);
  const liveReqRef = useRef(0);

  // fetchHistory probes/queries Prometheus for a range. Used both for the
  // initial probe (which also decides mode) and for range switches.
  const fetchHistory = useCallback(async (r: RangeKey, initial: boolean) => {
    const reqId = ++histReqRef.current;
    if (initial) setMode('loading'); else setHistLoading(true);
    try {
      const res = await k8sAPI.podMetricsHistory(
        connId, { context, namespace, pod: podName, range: r }, scope,
      );
      if (reqId !== histReqRef.current) return; // superseded
      const h = res.data as K8sPodMetricsHistoryResult;
      if (h?.available) {
        setHist(h);
        setHistWarn('');
        setMode('history');
      } else if (initial) {
        // No Prometheus discoverable → fall back to the live snapshot silently.
        setMode('live');
      }
    } catch (err) {
      if (reqId !== histReqRef.current) return;
      if (initial) {
        // Probe errored (RBAC / timeout / TLS): fall back to live but keep the
        // reason so missing services/proxy rights aren't hidden.
        setHistWarn(errText(err, t('podMetrics.unavailable')));
        setMode('live');
      } else {
        setHistWarn(errText(err, t('podMetrics.unavailable')));
      }
    } finally {
      if (reqId === histReqRef.current) setHistLoading(false);
    }
  }, [connId, context, namespace, podName, scope, t]);

  // On pod/tab activation: reset everything and probe for Prometheus once.
  useEffect(() => {
    setMode('loading');
    setHist(null);
    setRange(DEFAULT_RANGE);
    setHistWarn('');
    setSamples([]);
    setContainers([]);
    setAvailable(null);
    setReason('');
    setFetchedOnce(false);
    setFetchError('');

    if (!active || !connId || !context || !namespace || !podName) return;
    void fetchHistory(DEFAULT_RANGE, true);
    return () => { histReqRef.current += 1; }; // discard in-flight history on change/unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, connId, context, namespace, podName, scope]);

  // Live poll — runs ONLY in live mode (Prometheus absent/unreachable).
  useEffect(() => {
    if (mode !== 'live' || !active || !connId || !context) return;
    let stopped = false;

    const fetchOnce = async () => {
      const reqId = ++liveReqRef.current;
      try {
        const params: { context: string; namespace?: string } = { context };
        if (namespace) params.namespace = namespace;
        const res = await k8sAPI.podMetrics(connId, params, scope);
        if (stopped || reqId !== liveReqRef.current) return;
        const r = res.data as K8sPodMetricsResult;
        setFetchError('');
        setFetchedOnce(true);
        if (!r?.available) {
          setAvailable(false);
          setReason(r?.reason || t('podMetrics.needServer'));
          return;
        }
        setAvailable(true);
        const pod = (r.pods ?? []).find((p) => p.namespace === namespace && p.name === podName);
        if (!pod) {
          setContainers([]);
          return;
        }
        setContainers(pod.containers ?? []);
        setSamples((prev) => {
          const next = [...prev, { t: Date.now(), cpuMilli: pod.cpuMilli, memBytes: pod.memBytes }];
          return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
        });
      } catch (err) {
        if (stopped || reqId !== liveReqRef.current) return;
        setFetchedOnce(true);
        setFetchError(errText(err, t('podMetrics.unavailable')));
      }
    };

    const tick = () => { if (!document.hidden) void fetchOnce(); };
    tick();
    const timer = setInterval(tick, POLL_MS);
    const onVis = () => { if (!document.hidden) void fetchOnce(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      liveReqRef.current += 1;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [mode, active, connId, context, namespace, podName, scope, t]);

  const onPickRange = (r: RangeKey) => {
    if (r === range) return;
    setRange(r);
    void fetchHistory(r, false);
  };

  const tooltipContentStyle: React.CSSProperties = {
    background: 'var(--color-popover)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    fontSize: 11,
    color: 'var(--color-popover-foreground)',
    padding: '4px 8px',
  };
  const axisTick = { fontSize: 10, fill: 'var(--color-muted-foreground)' } as const;

  // ── Loading (probing for Prometheus) ───────────────────────────────────
  if (mode === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center p-6 gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('podMetrics.histChecking')}
      </div>
    );
  }

  // ── History (Prometheus) ────────────────────────────────────────────────
  if (mode === 'history') {
    const cpuData: Point[] = (hist?.cpu ?? []).map((p) => ({ t: p.t, v: p.val }));
    const memData: Point[] = (hist?.mem ?? []).map((p) => ({ t: p.t, v: p.val }));
    const latestCpu = lastVal(hist?.cpu);
    const latestMem = lastVal(hist?.mem);
    const fmtTick = range === '15m' ? fmtClockSec : fmtClock;
    const empty = cpuData.length === 0 && memData.length === 0;

    return (
      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
            <History className="h-3 w-3" />
            {t('podMetrics.histNote', { service: hist?.service || 'Prometheus' })}
          </span>
          <RangePicker value={range} onPick={onPickRange} loading={histLoading} />
        </div>

        {empty ? (
          <div className="flex items-center justify-center p-6">
            <p className="text-xs text-muted-foreground">{t('podMetrics.histEmpty')}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" style={{ color: CPU_COLOR }} />
                <span className="text-muted-foreground">{t('podMetrics.cpu')}</span>
                <span className="font-mono font-medium tabular-nums">{formatCpu(latestCpu)}</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1.5">
                <MemoryStick className="h-3.5 w-3.5" style={{ color: MEM_COLOR }} />
                <span className="text-muted-foreground">{t('podMetrics.mem')}</span>
                <span className="font-mono font-medium tabular-nums">{formatMem(latestMem)}</span>
              </span>
            </div>

            <MetricChart
              title={t('podMetrics.cpu')} gradKey="hcpu" color={CPU_COLOR} data={cpuData}
              tickFormatter={formatCpu} fmtTick={fmtTick}
              tooltipStyle={tooltipContentStyle} axisTick={axisTick}
            />
            <MetricChart
              title={t('podMetrics.memory')} gradKey="hmem" color={MEM_COLOR} data={memData}
              tickFormatter={formatMem} fmtTick={fmtTick}
              tooltipStyle={tooltipContentStyle} axisTick={axisTick}
            />

            <HistContainerTable containers={hist?.containers ?? []} t={t} />
          </>
        )}
      </div>
    );
  }

  // ── Live (metrics-server) — the fallback ────────────────────────────────
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;

  const warnBanner = histWarn ? (
    <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px]">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span className="min-w-0 break-words">{t('podMetrics.histWarn', { error: histWarn })}</span>
    </div>
  ) : null;

  if (available === false) {
    return (
      <div className="flex-1 flex flex-col p-3 gap-3">
        {warnBanner}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-[280px] text-center space-y-1.5">
            <AlertTriangle className="h-5 w-5 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{reason || t('podMetrics.needServer')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (samples.length === 0) {
    let inner: React.ReactNode;
    if (fetchError) {
      inner = (
        <div className="max-w-[280px] text-center space-y-1.5">
          <AlertTriangle className="h-5 w-5 mx-auto text-destructive" />
          <p className="text-xs text-muted-foreground">{fetchError}</p>
        </div>
      );
    } else if (fetchedOnce && available) {
      inner = <p className="text-xs text-muted-foreground">{t('podMetrics.noMetricsYet')}</p>;
    } else {
      inner = (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('podMetrics.collecting')}
        </span>
      );
    }
    return (
      <div className="flex-1 flex flex-col p-3 gap-3">
        {warnBanner}
        <div className="flex-1 flex items-center justify-center p-6">{inner}</div>
      </div>
    );
  }

  const cpuData: Point[] = samples.map((s) => ({ t: s.t, v: s.cpuMilli }));
  const memData: Point[] = samples.map((s) => ({ t: s.t, v: s.memBytes }));
  const showDots = samples.length < 2;

  return (
    <div className="flex-1 overflow-auto p-3 space-y-4">
      {warnBanner}
      <p className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
        <Activity className="h-3 w-3" />
        {t('podMetrics.liveNote')}
      </p>
      <div className="flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5" style={{ color: CPU_COLOR }} />
          <span className="text-muted-foreground">{t('podMetrics.cpu')}</span>
          <span className="font-mono font-medium tabular-nums">{formatCpu(latest?.cpuMilli)}</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="inline-flex items-center gap-1.5">
          <MemoryStick className="h-3.5 w-3.5" style={{ color: MEM_COLOR }} />
          <span className="text-muted-foreground">{t('podMetrics.mem')}</span>
          <span className="font-mono font-medium tabular-nums">{formatMem(latest?.memBytes)}</span>
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">{t('podMetrics.sampleRate', { n: POLL_MS / 1000 })}</span>
      </div>

      <MetricChart
        title={t('podMetrics.cpu')} gradKey="lcpu" color={CPU_COLOR} data={cpuData}
        tickFormatter={formatCpu} fmtTick={fmtClockSec} showDots={showDots}
        tooltipStyle={tooltipContentStyle} axisTick={axisTick}
      />
      <MetricChart
        title={t('podMetrics.memory')} gradKey="lmem" color={MEM_COLOR} data={memData}
        tickFormatter={formatMem} fmtTick={fmtClockSec} showDots={showDots}
        tooltipStyle={tooltipContentStyle} axisTick={axisTick}
      />

      {containers.length > 1 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('podMetrics.containersHeading', { count: containers.length })}
          </span>
          <div className="border rounded-md divide-y text-xs mt-1">
            {containers.map((c) => (
              <ContainerRow key={c.name} name={c.name} cpuMilli={c.cpuMilli} memBytes={c.memBytes} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RangePicker({
  value, onPick, loading,
}: {
  value: RangeKey;
  onPick: (r: RangeKey) => void;
  loading: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground mr-0.5" />}
      <div className="inline-flex rounded-md border p-0.5">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => onPick(r)}
            className={cn(
              'px-2 py-0.5 rounded text-[11px] font-medium tabular-nums transition-colors cursor-pointer',
              value === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function HistContainerTable({
  containers, t,
}: {
  containers: K8sPromContainerSeries[];
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  if (containers.length <= 1) return null;
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('podMetrics.containersHeading', { count: containers.length })}
      </span>
      <div className="border rounded-md divide-y text-xs mt-1">
        {containers.map((c) => (
          <ContainerRow
            key={c.container}
            name={c.container}
            cpuMilli={lastVal(c.cpu)}
            memBytes={lastVal(c.mem)}
          />
        ))}
      </div>
    </div>
  );
}

function ContainerRow({
  name, cpuMilli, memBytes,
}: {
  name: string;
  cpuMilli: number | undefined;
  memBytes: number | undefined;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <span className="font-mono truncate min-w-0 flex-1" title={name}>{name}</span>
      <span className="font-mono tabular-nums text-muted-foreground shrink-0" style={{ color: CPU_COLOR }}>
        {formatCpu(cpuMilli)}
      </span>
      <span className="font-mono tabular-nums text-muted-foreground shrink-0" style={{ color: MEM_COLOR }}>
        {formatMem(memBytes)}
      </span>
    </div>
  );
}

function MetricChart({
  title, gradKey, color, data, tickFormatter, fmtTick, showDots, tooltipStyle, axisTick,
}: {
  title: string;
  gradKey: string; // ASCII-only, unique per chart (localized titles can't be in an SVG url(#…))
  color: string;
  data: Point[];
  tickFormatter: (v: number) => string;
  fmtTick: (t: number) => string;
  showDots?: boolean;
  tooltipStyle: React.CSSProperties;
  axisTick: { fontSize: number; fill: string };
}) {
  const gradId = `pmc-grad-${gradKey}`;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTick}
              minTickGap={40}
              tick={axisTick}
              stroke="var(--color-border)"
              tickLine={false}
            />
            <YAxis
              width={48}
              tickFormatter={(v: number) => tickFormatter(v)}
              tick={axisTick}
              stroke="var(--color-border)"
              tickLine={false}
              domain={[0, 'auto']}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: 'var(--color-muted-foreground)', fontSize: 10 }}
              labelFormatter={(label: number) => fmtTick(label)}
              formatter={(value: number) => [tickFormatter(value), title]}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#${gradId})`}
              isAnimationActive={false}
              dot={showDots ? { r: 2, fill: color, stroke: color } : false}
              activeDot={{ r: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
