import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PieChart, Pie, Cell,
  RadialBarChart, RadialBar, PolarAngleAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Server,
  Boxes,
  Box,
  Layers,
  Network,
  Bell,
  Cpu,
  MemoryStick,
  LayoutDashboard,
} from 'lucide-react';
import { k8sAPI, type DBScope } from '@/services/api';
import type { ClusterOverview } from '@/types';
import { formatBytes } from '@/components/dbquery/formatters';
import { Button } from '@/components/ui/button';
import { K8sIcon } from '@/components/icons/K8sIcon';
import { cn } from '@/lib/utils';

interface K8sOverviewProps {
  connId: string;
  context: string;
  connName: string;
  scope: DBScope;
}

// Pod-phase status hues — reserved status colors (state, not category), each
// carried with a label in the donut legend so identity is never color-alone.
// Matches the app's statusTone language (emerald/amber/blue/red/gray).
const PHASE_COLORS: Record<string, string> = {
  running: '#10b981',   // emerald-500
  pending: '#f59e0b',   // amber-500
  succeeded: '#3b82f6', // blue-500
  failed: '#ef4444',    // red-500
  unknown: '#9ca3af',   // gray-400
};

// Pod-phase enum names stay English (kept in step with the raw API phase);
// labelKey is resolved with t() at render.
const PHASE_ORDER: { key: keyof ClusterOverview['pods']; labelKey: string }[] = [
  { key: 'running', labelKey: 'overview.phaseRunning' },
  { key: 'pending', labelKey: 'overview.phasePending' },
  { key: 'succeeded', labelKey: 'overview.phaseSucceeded' },
  { key: 'failed', labelKey: 'overview.phaseFailed' },
  { key: 'unknown', labelKey: 'overview.phaseUnknown' },
];

// Utilization → threshold color (sequential magnitude that crosses into
// warning/critical), used for the CPU/mem gauges + per-node bars.
function utilColor(pct: number): string {
  if (pct >= 90) return '#ef4444'; // red-500
  if (pct >= 75) return '#f59e0b'; // amber-500
  return '#10b981';                // emerald-500
}

// Compact core formatting: fractional under 10 cores, whole above.
function formatCores(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 10) return String(Math.round(n));
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function pct(used: number | undefined, cap: number | undefined): number {
  if (!used || !cap || cap <= 0) return 0;
  return Math.min(100, (used / cap) * 100);
}

// K8sOverview is the Lens-style cluster dashboard for the selected
// connection+context: a health header, six stat cards, a pod-phase donut and
// (when metrics-server is present) CPU/memory gauges plus per-node bars. It
// fetches its own snapshot from GET /k8s/:id/overview and owns loading / error
// / empty states + a Refresh button. Design language matches
// K8sExplorerPanel / the Redis/Kafka/S3 tools (semantic tones, text-xs/sm,
// bordered cards, dark: variants).
export function K8sOverview({ connId, context, connName, scope }: K8sOverviewProps) {
  const { t } = useTranslation('k8s');
  const [data, setData] = useState<ClusterOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!connId || !context) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      const res = await k8sAPI.overview(connId, { context }, scope);
      setData(res.data as ClusterOverview);
    } catch (err) {
      setError(extractErr(err, t('overview.loadFailed')));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [connId, context, scope, t]);

  useEffect(() => { load(); }, [load]);

  // ── Empty (no connection/context) ──────────────────────────────────
  if (!connId || !context) {
    return (
      <div className="flex-1 min-w-0 flex flex-col">
        <Centered
          icon={<K8sIcon className="h-8 w-8 text-muted-foreground/40" />}
          text={t('overview.selectClusterContext')}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <OverviewHeader connName={connName} data={null} loading={loading} onRefresh={load} />
        <div className="p-4 flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap font-mono">{error}</pre>
        </div>
      </div>
    );
  }

  // ── Loading (first load, no data yet) ──────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <OverviewHeader connName={connName} data={null} loading={loading} onRefresh={load} />
        <Centered icon={<Loader2 className="h-4 w-4 animate-spin" />} text={t('overview.loading')} />
      </div>
    );
  }

  if (!data) return null;

  const { nodes, pods, workloads, networking, events, metrics } = data;

  const phaseData = PHASE_ORDER
    .map((p) => ({ key: p.key, label: t(p.labelKey), value: pods[p.key] }))
    .filter((d) => d.value > 0);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
      <OverviewHeader connName={connName} data={data} loading={loading} onRefresh={load} />

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {/* Stat cards — responsive so they fill the panel width at wide sizes. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* Nodes */}
          <StatCard icon={Server} title={t('overview.nodes')}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">{nodes.ready}</span>
              <span className="text-sm text-muted-foreground">{t('overview.nodesReady', { total: nodes.total })}</span>
            </div>
            {nodes.notReady > 0 && (
              <div className="mt-1 text-[11px] text-amber-500 flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                {t('overview.notReady', { count: nodes.notReady })}
              </div>
            )}
          </StatCard>

          {/* Namespaces */}
          <StatCard icon={Boxes} title={t('overview.namespaces')}>
            <span className="text-2xl font-semibold tabular-nums">{data.namespaces}</span>
          </StatCard>

          {/* Pods with phase breakdown */}
          <StatCard icon={Box} title={t('overview.pods')}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">{pods.total}</span>
              <span className="text-sm text-muted-foreground">{t('overview.total')}</span>
            </div>
            {/* Compact stacked phase bar (2px surface gaps between fills) */}
            {pods.total > 0 && (
              <div className="mt-2 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
                {PHASE_ORDER.filter((p) => pods[p.key] > 0).map((p) => (
                  <div
                    key={p.key}
                    className="h-full rounded-full"
                    style={{ width: `${(pods[p.key] / pods.total) * 100}%`, backgroundColor: PHASE_COLORS[p.key] }}
                    title={`${t(p.labelKey)}: ${pods[p.key]}`}
                  />
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <PhaseChip color={PHASE_COLORS.running} label={t('overview.phaseRunning')} value={pods.running} />
              <PhaseChip color={PHASE_COLORS.pending} label={t('overview.phasePending')} value={pods.pending} />
              <PhaseChip color={PHASE_COLORS.failed} label={t('overview.phaseFailed')} value={pods.failed} danger={pods.failed > 0} />
            </div>
          </StatCard>

          {/* Workloads */}
          <StatCard icon={Layers} title={t('overview.workloads')}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <MiniStat label={t('overview.wDeployments')} value={workloads.deployments} />
              <MiniStat label={t('overview.wStatefulSets')} value={workloads.statefulSets} />
              <MiniStat label={t('overview.wDaemonSets')} value={workloads.daemonSets} />
              <MiniStat label={t('overview.wJobs')} value={workloads.jobs} />
              <MiniStat label={t('overview.wCronJobs')} value={workloads.cronJobs} />
              <MiniStat label={t('overview.wReplicaSets')} value={workloads.replicaSets} />
            </div>
          </StatCard>

          {/* Networking */}
          <StatCard icon={Network} title={t('overview.networking')}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <MiniStat label={t('overview.nServices')} value={networking.services} />
              <MiniStat label={t('overview.nIngresses')} value={networking.ingresses} />
              <MiniStat label={t('overview.nConfigMaps')} value={networking.configMaps} />
              <MiniStat label={t('overview.nSecrets')} value={networking.secrets} />
            </div>
          </StatCard>

          {/* Events */}
          <StatCard icon={Bell} title={t('overview.events')}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">{events.total}</span>
              <span className="text-sm text-muted-foreground">{t('overview.total')}</span>
            </div>
            <div className={cn('mt-1 text-[11px] flex items-center gap-1', events.warnings > 0 ? 'text-destructive' : 'text-muted-foreground')}>
              <AlertTriangle className="h-3 w-3" />
              {t(events.warnings === 1 ? 'overview.warningsOne' : 'overview.warningsOther', { count: events.warnings })}
            </div>
          </StatCard>
        </div>

        {/* Charts row: pod-phase donut + cluster metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Pod-phase donut */}
          <Panel title={t('overview.podPhases')} icon={Box}>
            {pods.total === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">{t('overview.noPods')}</div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="relative h-40 w-40 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip
                        wrapperClassName="!text-xs"
                        formatter={(value: number, name: string) => [value, name]}
                      />
                      <Pie
                        data={phaseData}
                        dataKey="value"
                        nameKey="label"
                        innerRadius="62%"
                        outerRadius="90%"
                        paddingAngle={2}
                        stroke="none"
                      >
                        {phaseData.map((d) => (
                          <Cell key={d.key} fill={PHASE_COLORS[d.key] ?? PHASE_COLORS.unknown} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xl font-semibold tabular-nums">{pods.total}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('overview.podsLabel')}</span>
                  </div>
                </div>
                {/* Legend — colored dot + label + count, text in ink tokens */}
                <ul className="flex-1 min-w-0 space-y-1">
                  {PHASE_ORDER.map((p) => (
                    <li key={p.key} className="flex items-center gap-2 text-xs">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: PHASE_COLORS[p.key] }} />
                      <span className="text-muted-foreground flex-1 truncate">{t(p.labelKey)}</span>
                      <span className="tabular-nums font-medium">{pods[p.key]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {/* Cluster metrics — gauges + per-node, or the install hint */}
          <Panel title={t('overview.clusterMetrics')} icon={Cpu}>
            {metrics.available ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MetricGauge
                    icon={Cpu}
                    label={t('overview.cpu')}
                    percent={pct(metrics.cpuUsedCores, metrics.cpuCapacityCores)}
                    used={`${formatCores(metrics.cpuUsedCores)}`}
                    capacity={t('overview.coresValue', { value: formatCores(metrics.cpuCapacityCores) })}
                  />
                  <MetricGauge
                    icon={MemoryStick}
                    label={t('overview.memory')}
                    percent={pct(metrics.memUsedBytes, metrics.memCapacityBytes)}
                    used={formatBytes(metrics.memUsedBytes ?? 0)}
                    capacity={formatBytes(metrics.memCapacityBytes ?? 0)}
                  />
                </div>
                {metrics.nodes && metrics.nodes.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {t('overview.perNode')}
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {metrics.nodes.map((n) => {
                        const cpuPct = pct(n.cpuUsedCores, n.cpuCapacityCores);
                        const memPct = pct(n.memUsedBytes, n.memCapacityBytes);
                        return (
                          <div key={n.name} className="text-[11px]">
                            <div className="truncate font-mono text-foreground/80 mb-0.5" title={n.name}>{n.name}</div>
                            <div className="flex items-center gap-2">
                              <span className="w-8 shrink-0 text-muted-foreground">{t('overview.cpu')}</span>
                              <NodeBar percent={cpuPct} />
                              <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                                {formatCores(n.cpuUsedCores)}/{formatCores(n.cpuCapacityCores)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="w-8 shrink-0 text-muted-foreground">{t('overview.mem')}</span>
                              <NodeBar percent={memPct} />
                              <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                                {formatBytes(n.memUsedBytes)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-40 flex flex-col items-center justify-center gap-2 text-center px-4">
                <Cpu className="h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  {t('overview.metricsUnavailable')}
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────
function OverviewHeader({
  connName, data, loading, onRefresh,
}: {
  connName: string;
  data: ClusterOverview | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('k8s');
  const health = data ? clusterHealth(data) : null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20">
      <LayoutDashboard className="h-4 w-4 text-blue-500 shrink-0" />
      <span className="text-sm font-semibold truncate">{connName || t('overview.clusterFallback')}</span>
      {data && (
        <>
          <span className="text-[11px] font-mono text-muted-foreground">{data.version.version}</span>
          {data.version.platform && (
            <span className="text-[11px] text-muted-foreground">· {data.version.platform}</span>
          )}
          {health && (
            <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', health.text)}>
              <span className={cn('inline-block h-2 w-2 rounded-full', health.dot)} />
              {t(health.labelKey)}
            </span>
          )}
        </>
      )}
      <div className="flex-1" />
      <Button size="sm" variant="ghost" className="gap-1.5 h-8" disabled={loading} onClick={onRefresh}>
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        <span className="text-xs">{t('common:refresh')}</span>
      </Button>
    </div>
  );
}

// Green/yellow/red health from the node ready ratio (and reachability).
// labelKey is resolved with t() where the badge renders.
function clusterHealth(data: ClusterOverview): { labelKey: string; dot: string; text: string } {
  if (!data.version.reachable) {
    return { labelKey: 'overview.healthUnreachable', dot: 'bg-destructive', text: 'text-destructive' };
  }
  const { total, ready } = data.nodes;
  if (total === 0) {
    return { labelKey: 'overview.healthUnknown', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' };
  }
  const ratio = ready / total;
  if (ratio >= 1) return { labelKey: 'overview.healthHealthy', dot: 'bg-emerald-500', text: 'text-emerald-500' };
  if (ratio >= 0.5) return { labelKey: 'overview.healthDegraded', dot: 'bg-amber-500', text: 'text-amber-500' };
  return { labelKey: 'overview.healthCritical', dot: 'bg-destructive', text: 'text-destructive' };
}

// ── Building blocks ──────────────────────────────────────────────────────────
function StatCard({ icon: Icon, title, children }: { icon: typeof Server; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-blue-500" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: typeof Server; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-blue-500" />
        {title}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}

function PhaseChip({ color, label, value, danger }: { color: string; label: string; value: number; danger?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums font-medium', danger ? 'text-destructive' : 'text-foreground')}>{value}</span>
    </span>
  );
}

// Radial gauge — PolarAngleAxis with a fixed [0,100] domain so the arc encodes
// the true percentage (without it recharts scales to the data max and every
// gauge reads full). Centered numeric + used/capacity label overlay.
function MetricGauge({
  icon: Icon, label, percent, used, capacity,
}: {
  icon: typeof Server;
  label: string;
  percent: number;
  used: string;
  capacity: string;
}) {
  const color = utilColor(percent);
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            data={[{ value: percent, fill: color }]}
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              background={{ fill: 'rgba(148,163,184,0.15)' }}
              dataKey="value"
              cornerRadius={8}
              angleAxisId={0}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <Icon className="h-3.5 w-3.5 text-muted-foreground mb-0.5" />
          <span className="text-lg font-semibold tabular-nums" style={{ color }}>{Math.round(percent)}%</span>
        </div>
      </div>
      <div className="text-center mt-0.5">
        <div className="text-[11px] font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">{used} / {capacity}</div>
      </div>
    </div>
  );
}

function NodeBar({ percent }: { percent: number }) {
  return (
    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(2, percent)}%`, backgroundColor: utilColor(percent) }}
      />
    </div>
  );
}

function Centered({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground p-8 text-center">
      {icon}
      {text}
    </div>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
