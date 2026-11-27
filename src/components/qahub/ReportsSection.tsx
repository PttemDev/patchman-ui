import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Bot, Bug, FlaskConical, GitPullRequest, Loader2, RefreshCw, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { qaAPI } from '@/services/api';
import type { QAReports } from '@/types';
import { SIGNAL_KINDS } from './qaRadarUtil';

// Signal palette (distinct hues, readable in both themes).
const SIGNAL_COLORS: Record<string, string> = {
  stuck: '#ef4444', awaitingReview: '#f59e0b', noJira: '#f97316', jiraMismatch: '#d946ef',
  noTests: '#eab308', large: '#0ea5e9', collision: '#8b5cf6', aiAssisted: '#64748b',
};
const SEV = ['blocker', 'major', 'minor', 'nit'] as const;
const DECISIONS = [
  { key: 'posted', color: '#10b981' }, { key: 'approved', color: '#3b82f6' },
  { key: 'pending', color: '#94a3b8' }, { key: 'rejected', color: '#ef4444' },
] as const;
const tooltipStyle = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--popover-foreground)' };
const axis = { fontSize: 11, fill: 'var(--muted-foreground)' };

function Tile({ icon: Icon, label, value, sub, tone }: { icon: typeof Bug; label: string; value: string | number; sub?: string; tone: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-muted/40 to-transparent p-4">
      <div className={cn('flex items-center gap-2 text-xs font-medium', tone)}><Icon className="h-4 w-4" />{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-3 flex items-baseline gap-2"><h3 className="text-sm font-semibold">{title}</h3>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</div>
      {children}
    </section>
  );
}

// Reports (CR_QA_RFC P3): team-level trends — never per person.
export function ReportsSection() {
  const { t } = useTranslation('qa');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<QAReports | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await qaAPI.reports(days)).data); } catch { setData(null); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const radar = useMemo(() => (data?.radar ?? []).map((r) => ({ day: r.day.slice(5), open: r.openMrs, ...r.signals, median: r.leadMedianH, p90: r.leadP90H })), [data]);
  const tests = useMemo(() => (data?.tests ?? []).map((r) => ({ day: r.day.slice(5), passed: r.passed, failed: r.failed })), [data]);
  const findings = useMemo(() => SEV.map((s) => ({ severity: t(`review.severity.${s}`), ...(data?.reviews.findings?.[s] ?? {}) })), [data, t]);
  const latest = data?.radar[data.radar.length - 1];
  const tt = data?.testTotals;
  const passRate = tt && tt.passed + tt.failed > 0 ? Math.round((tt.passed / (tt.passed + tt.failed)) * 100) : null;

  if (!data && loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('reports.loading')}</div>;
  if (!data) return <p className="text-sm text-muted-foreground">{t('reports.loadFailed')}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('reports.teamOnly')}</span>
        <div className="ml-auto flex rounded-md border p-0.5">
          {[7, 30, 90].map((d) => (
            <Button key={d} variant="ghost" size="sm" aria-pressed={days === d} onClick={() => setDays(d)}
              className={cn('h-7 px-2 text-xs', days === d && 'bg-primary/15 text-primary hover:bg-primary/20')}>{t('reports.days', { count: d })}</Button>
          ))}
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void load()} aria-label={t('radar.refresh')}><RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /></Button>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
        <Tile icon={GitPullRequest} label={t('reports.openMrs')} value={latest?.openMrs ?? '—'} sub={latest ? t('reports.stuckNow', { count: latest.signals.stuck ?? 0 }) : t('reports.noSnapshot')} tone="text-sky-600 dark:text-sky-400" />
        <Tile icon={Timer} label={t('reports.leadTime')} value={latest?.leadMedianH != null ? `${latest.leadMedianH} h` : '—'} sub={latest?.leadP90H != null ? t('reports.p90', { h: latest.leadP90H }) : undefined} tone="text-violet-600 dark:text-violet-400" />
        <Tile icon={FlaskConical} label={t('reports.passRate')} value={passRate != null ? `${passRate}%` : '—'} sub={tt ? t('reports.runs', { count: tt.runs }) : undefined} tone="text-emerald-600 dark:text-emerald-400" />
        <Tile icon={Bug} label={t('reports.defects')} value={data.defects.open} sub={t('reports.defectsSub', { closed: data.defects.closed, created: data.defects.createdInWindow })} tone="text-red-600 dark:text-red-400" />
      </div>

      <div className="grid gap-4 @5xl:grid-cols-2">
        <Card title={t('reports.radarTrend')} hint={t('reports.radarHint')}>
          {radar.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">{t('reports.noSnapshot')}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={radar}>
                <defs>{SIGNAL_KINDS.map((k) => (
                  <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SIGNAL_COLORS[k]} stopOpacity={0.55} /><stop offset="100%" stopColor={SIGNAL_COLORS[k]} stopOpacity={0.05} /></linearGradient>
                ))}</defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={axis} /><YAxis tick={axis} allowDecimals={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SIGNAL_KINDS.map((k) => <Area key={k} type="monotone" dataKey={k} name={t(`radar.signal.${k}.label`)} stackId="s" stroke={SIGNAL_COLORS[k]} fill={`url(#g-${k})`} isAnimationActive />)}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title={t('reports.leadTrend')} hint={t('reports.leadHint')}>
          {radar.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">{t('reports.noSnapshot')}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={radar}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={axis} /><YAxis tick={axis} width={32} unit="h" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="median" name={t('reports.median')} stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p90" name="p90" stroke="#0ea5e9" strokeDasharray="4 3" dot={false} />
                <Line type="monotone" dataKey="open" name={t('reports.openMrs')} stroke="#94a3b8" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title={t('reports.testTrend')}>
          {tests.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">{t('reports.noRuns')}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={tests}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={axis} /><YAxis tick={axis} allowDecimals={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="passed" name={t('reports.passed')} stackId="t" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" name={t('reports.failed')} stackId="t" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title={t('reports.aiFindings')} hint={t('reports.aiHint', { count: data.reviews.count })}>
          {data.reviews.count === 0 ? <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground"><Bot className="h-4 w-4" />{t('reports.noReviews')}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={findings} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="severity" tick={axis} width={70} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {DECISIONS.map((d) => <Bar key={d.key} dataKey={d.key} name={t(`review.status.${d.key}`)} stackId="f" fill={d.color} />)}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}
