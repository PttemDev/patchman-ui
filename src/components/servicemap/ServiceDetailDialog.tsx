import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Bell, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TimeSeriesChart, type ChartSeries } from '@/components/charts/TimeSeriesChart';
import { PALETTE } from '@/components/grafana/grafanaFrames';
import { observabilityConnectionAPI, serviceMapAPI } from '@/services/api';
import type { DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ObservabilityConnection, ServiceDetail, ServiceDetailChart, ServiceMapNode, ServiceMapSourceRef } from '@/types';
import { HealthIcon } from './ServiceNodeCard';
import { errorKnown, fmtMs, fmtPct, fmtRate, fmtRps, loadRateUnit, saveRateUnit, type RateUnit } from './serviceMapUtil';

const RANGES = ['30m', '1h', '6h', '24h', '7d'] as const;
const RANGE_KEY = 'patchman_sm_detail_range';
const HEALTH_COLOR: Record<string, string> = { ok: 'text-emerald-500', warning: 'text-amber-500', critical: 'text-red-500', unknown: 'text-muted-foreground' };

function loadRange(): string {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    return v && (RANGES as readonly string[]).includes(v) ? v : '1h';
  } catch {
    return '1h';
  }
}

function errText(e: unknown, fallback: string): { msg: string; unsupported: boolean } {
  const r = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
  return { msg: r?.data?.error || fallback, unsupported: r?.status === 501 };
}

const n = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** A chart value in its unit. */
function formatter(unit: string, rate: RateUnit): (v: number) => string {
  switch (unit) {
    case 'rps': return (v) => fmtRate(v, rate);
    case 'ms': return (v) => fmtMs(v);
    case 'ratio': return (v) => fmtPct(v);
    case 'score': return (v) => v.toFixed(2);
    default: return (v) => (Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? fmtRps(v) : String(Number(v.toFixed(2))));
  }
}

function refLabel(r: ServiceMapSourceRef, conns: ObservabilityConnection[], t: TFunction): string {
  if (r.conn.startsWith('k8s:')) return t('serviceDetail.clusterProm');
  return conns.find((c) => c.id === r.conn)?.name ?? r.source;
}

function chartTitle(c: ServiceDetailChart, t: TFunction): string {
  if (c.id === 'other') return c.title || c.group || '';
  return t(`serviceDetail.chart.${c.id}`, { defaultValue: c.title || c.id });
}

function noteText(note: string, t: TFunction): string {
  if (note.startsWith('family:')) return t('serviceDetail.note.family', { family: note.slice(7) });
  if (note.startsWith('family_error:')) return t('serviceDetail.note.familyError', { detail: note.slice(13) });
  return t(`serviceDetail.note.${note}`, { defaultValue: note });
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-primary/[0.06] to-transparent px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 font-mono text-lg tabular-nums', tone === 'bad' && 'text-red-500', tone === 'warn' && 'text-amber-500')}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Section({ title, count, error, children }: { title: string; count?: number; error?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        {title}{count != null && <span className="rounded bg-muted px-1.5 text-[10px] font-normal text-muted-foreground">{count}</span>}
      </h3>
      {error && (
        <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      {children}
    </section>
  );
}

function Table({ head, rows, right }: { head: string[]; rows: Array<Array<React.ReactNode>>; right?: number[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className={cn('whitespace-nowrap px-2 py-1 text-left font-medium', right?.includes(i) && 'text-right')}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t hover:bg-accent/30">
              {r.map((c, j) => <td key={j} className={cn('max-w-[420px] truncate px-2 py-1', right?.includes(j) && 'text-right font-mono tabular-nums')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One service's APM page — throughput, latency, errors (and Apdex) over a
// range, its busiest endpoints, error classes, instances, health checks and
// alerts — from the observability connection the node came from. What a
// backend doesn't report is left out, never estimated.
export function ServiceDetailDialog({ open, onOpenChange, node, scope, obsConns }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: ServiceMapNode | null;
  scope?: DBScope;
  obsConns: ObservabilityConnection[];
}) {
  const { t } = useTranslation('servicemap');
  const refs = useMemo(() => node?.refs ?? [], [node]);
  const [refIdx, setRefIdx] = useState(0);
  const [range, setRangeState] = useState(loadRange);
  const [unit, setUnitState] = useState<RateUnit>(loadRateUnit);
  const [data, setData] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ msg: string; unsupported: boolean } | null>(null);
  const ref = refs[Math.min(refIdx, Math.max(0, refs.length - 1))];

  // The table may have changed the unit since this dialog mounted.
  useEffect(() => { if (open) { setRefIdx(0); setUnitState(loadRateUnit()); } }, [open, node?.id]);
  const setRange = (r: string) => {
    setRangeState(r);
    try { localStorage.setItem(RANGE_KEY, r); } catch { /* per view only */ }
  };
  const setUnit = (u: RateUnit) => { setUnitState(u); saveRateUnit(u); };

  // Only the latest request may fill the page (a slow answer for the
  // previous service or range is dropped).
  const reqSeq = useRef(0);
  const shown = useRef('');
  const load = useCallback(async () => {
    if (!ref) return;
    const seq = ++reqSeq.current;
    const id = `${node?.id}|${ref.conn}|${ref.name}|${range}`;
    if (shown.current !== id) setData(null); // another service / source / range: don't show the old one
    setLoading(true);
    setError(null);
    try {
      const p = { service: ref.name, namespace: ref.namespace, key: ref.key, scope: ref.scope, range };
      const res = ref.conn.startsWith('k8s:')
        ? await serviceMapAPI.serviceDetail(ref.conn.slice(4), ref.scope, p, scope)
        : await observabilityConnectionAPI.serviceDetail(ref.conn, p, scope);
      if (seq !== reqSeq.current) return;
      shown.current = id;
      setData(res.data as ServiceDetail);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      shown.current = '';
      setData(null);
      setError(errText(e, t('serviceDetail.failed')));
    }
    setLoading(false);
  }, [ref, range, scope, t, node?.id]);
  useEffect(() => {
    if (!open) { reqSeq.current++; shown.current = ''; setData(null); setError(null); setLoading(false); }
  }, [open]);
  useEffect(() => { if (open && ref) void load(); }, [open, load, ref]);

  const syncId = useMemo(() => `sd-${node?.id ?? ''}`, [node?.id]);
  const xDomain = useMemo<[number, number] | undefined>(() => {
    if (!data) return undefined;
    const now = Date.now();
    return [now - data.rangeSec * 1000, now];
  }, [data]);

  if (!node) return null;
  const s = data?.summary;
  const ms = node.stats;
  // Headline numbers: the backend's over the range, else the map's (labelled).
  const fromMap = !s;
  const rps = s ? s.rps : (ms.hasRed ? ms.rps : null);
  const err = s ? s.errorRate : (errorKnown(ms) ? ms.errorRate : null);
  const p95 = s ? s.p95Ms : (ms.p95Ms ?? null);
  const pe = data?.panelErrors ?? {};
  const charts = (data?.charts ?? []).filter(Boolean);
  const std = charts.filter((c) => c.id !== 'other');
  const other = charts.filter((c) => c.id === 'other');
  const alerts = data?.alerts ?? [];
  const openAlerts = alerts.filter((a) => String(a.state) === 'open').length;

  const renderChart = (c: ServiceDetailChart, i: number) => {
    // Lists may come back null from an older backend: treat as empty.
    const series: ChartSeries[] = (c.series ?? []).map((sr, j) => ({
      key: `${i}-${j}`, name: sr.name ? t(`serviceDetail.series.${sr.name}`, { defaultValue: sr.name }) : '',
      color: c.id === 'errors' ? '#E24D42' : PALETTE[(j + (c.id === 'latency' ? 2 : 0)) % PALETTE.length],
      points: (sr.points ?? []).map(([tt, v]) => ({ t: tt, v })),
    }));
    return (
      <div key={i} className="rounded-lg border p-2">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium">{chartTitle(c, t)}</span>
          {c.group && c.id === 'other' && <span className="shrink-0 text-[10px] text-muted-foreground">{c.group}</span>}
        </div>
        {series.some((x) => x.points.length > 0)
          ? <TimeSeriesChart series={series} format={formatter(c.unit, unit)} syncId={syncId} xDomain={xDomain} fillOpacity={c.id === 'throughput' ? 15 : 0} lineWidth={1.5} className="h-44" legend={series.length > 1 ? 'list' : 'hidden'} />
          : <p className="flex h-44 items-center justify-center text-[11px] text-muted-foreground">{t('serviceDetail.noData')}</p>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[95vw] max-w-[1400px] flex-col gap-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <HealthIcon health={node.health} className={cn('h-4 w-4', HEALTH_COLOR[node.health])} />
          <DialogTitle className="text-base">{node.name}</DialogTitle>
          {node.namespace && <span className="text-xs text-muted-foreground">{node.namespace}</span>}
          {refs.length > 1 && (
            <div className="flex rounded-md border overflow-hidden" role="tablist" aria-label={t('serviceDetail.source')}>
              {refs.map((r, i) => (
                <button key={`${r.conn}-${i}`} type="button" role="tab" aria-selected={i === refIdx} onClick={() => setRefIdx(i)}
                  className={cn('h-7 px-2 text-xs', i > 0 && 'border-l', i === refIdx ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/50')}>
                  {refLabel(r, obsConns, t)}
                </button>
              ))}
            </div>
          )}
          {refs.length === 1 && ref && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{refLabel(ref, obsConns, t)}</span>}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {RANGES.map((r, i) => (
                <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
                  className={cn('h-7 px-2 text-xs', i > 0 && 'border-l', range === r ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/50')}>
                  {t(`serviceDetail.range.${r}`)}
                </button>
              ))}
            </div>
            <div className="flex rounded-md border overflow-hidden" title={t('table.unitHint')}>
              <button type="button" onClick={() => setUnit('rps')} aria-pressed={unit === 'rps'} className={cn('h-7 px-2 text-xs', unit === 'rps' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/50')}>{t('table.unitRps')}</button>
              <button type="button" onClick={() => setUnit('rpm')} aria-pressed={unit === 'rpm'} className={cn('h-7 px-2 text-xs border-l', unit === 'rpm' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/50')}>{t('table.unitRpm')}</button>
            </div>
            <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => void load()} disabled={loading || !ref} title={t('common:refresh')}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={unit === 'rpm' ? t('table.rpm') : t('table.rps')} value={n(rps) ? fmtRate(rps, unit) : '—'} hint={fromMap ? t('serviceDetail.fromMap') : undefined} />
            <Tile label={t('table.errors')} value={n(err) ? fmtPct(err) : '—'} tone={n(err) && err >= 0.05 ? 'bad' : n(err) && err >= 0.01 ? 'warn' : undefined} />
            <Tile label={t('serviceDetail.avg')} value={n(s?.avgMs) ? fmtMs(s!.avgMs!) : '—'} />
            <Tile label="p95" value={n(p95) ? fmtMs(p95) : '—'} />
            <Tile label="p99" value={n(s?.p99Ms) ? fmtMs(s!.p99Ms!) : '—'} />
            <Tile label="Apdex" value={n(s?.apdex) ? s!.apdex!.toFixed(2) : '—'} tone={n(s?.apdex) && s!.apdex! < 0.7 ? 'bad' : n(s?.apdex) && s!.apdex! < 0.85 ? 'warn' : undefined} />
          </div>

          {refs.length === 0 && (
            <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground"><Info className="h-4 w-4" />{t('serviceDetail.noSource')}</p>
          )}
          {loading && !data && <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {error && (
            <div className={cn('flex items-start gap-2 rounded p-3 text-xs', error.unsupported ? 'border border-dashed text-muted-foreground' : 'bg-destructive/10 text-destructive')}>
              {error.unsupported ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="min-w-0 break-words">{error.msg}</span>
            </div>
          )}

          {data && (
            <>
              {pe.summary && <Section title={t('serviceDetail.summary')} error={pe.summary}>{null}</Section>}
              {(std.length > 0 || pe.charts) && (
                <Section title={t('serviceDetail.charts')} error={pe.charts}>
                  <div className="grid gap-3 lg:grid-cols-2">{std.map(renderChart)}</div>
                </Section>
              )}

              {(alerts.length > 0 || pe.alerts) && (
                <Section title={t('serviceDetail.alerts')} count={alerts.length} error={pe.alerts}>
                  <div className="space-y-1">
                    {alerts.slice(0, 30).map((a, i) => (
                      <div key={i} className={cn('flex items-center gap-2 rounded border px-2 py-1 text-xs', String(a.state) === 'open' && 'border-red-500/40 bg-red-500/5')}>
                        <Bell className={cn('h-3.5 w-3.5 shrink-0', String(a.state) === 'open' ? 'text-red-500' : 'text-muted-foreground')} />
                        <span className="min-w-0 flex-1 truncate">{String(a.title ?? '')}</span>
                        {a.priority != null && <span className="text-[10px] uppercase text-muted-foreground">{String(a.priority)}</span>}
                        <span className="text-[10px] text-muted-foreground">{String(a.state ?? '')}</span>
                        {typeof a.openedAt === 'number' && <span className="text-[10px] text-muted-foreground">{new Date(a.openedAt).toLocaleString()}</span>}
                      </div>
                    ))}
                  </div>
                  {openAlerts === 0 && alerts.length > 0 && <p className="text-[11px] text-muted-foreground">{t('serviceDetail.noOpenAlerts')}</p>}
                </Section>
              )}

              {(data.checks?.length || 0) > 0 && (
                <Section title={t('serviceDetail.checks')} count={data.checks!.length}>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {data.checks!.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 rounded border px-2 py-1 text-xs">
                        {c.status === 'ok' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <HealthIcon health={c.status} className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', HEALTH_COLOR[c.status])} />}
                        <span className="min-w-0">
                          <span className="font-medium">{c.title}</span>{c.group && <span className="ml-1 text-[10px] text-muted-foreground">{c.group}</span>}
                          {c.message && <span className="block text-[11px] text-muted-foreground">{c.message}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {(data.endpoints?.length || pe.endpoints) && (
                <Section title={t('serviceDetail.endpoints')} count={data.endpoints?.length} error={pe.endpoints}>
                  {(data.endpoints?.length ?? 0) > 0 && (
                    <Table right={[1, 2, 3, 4, 5]}
                      head={[t('serviceDetail.endpoint'), unit === 'rpm' ? t('table.rpm') : t('table.rps'), t('serviceDetail.avg'), 'p95', t('table.errors'), t('serviceDetail.timeShare')]}
                      rows={data.endpoints!.map((e) => [
                        <span title={e.name}>{e.name}</span>,
                        n(e.rps) ? fmtRate(e.rps, unit) : '—', n(e.avgMs) ? fmtMs(e.avgMs) : '—', n(e.p95Ms) ? fmtMs(e.p95Ms) : '—',
                        n(e.errorRate) ? fmtPct(e.errorRate) : '—',
                        n(e.timeShare) ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block h-1.5 w-14 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary/70" style={{ width: `${Math.round(e.timeShare * 100)}%` }} /></span>
                            {fmtPct(e.timeShare)}
                          </span>
                        ) : '—',
                      ])} />
                  )}
                </Section>
              )}

              {(data.errors?.length || pe.errors) && (
                <Section title={t('serviceDetail.errors')} count={data.errors?.length} error={pe.errors}>
                  {(data.errors?.length ?? 0) > 0 && (
                    <Table right={[2]}
                      head={[t('serviceDetail.errorClass'), t('serviceDetail.message'), t('serviceDetail.count'), t('serviceDetail.lastSeen')]}
                      rows={data.errors!.map((e) => [
                        <span className="font-mono" title={e.class}>{e.class}</span>, <span title={e.message}>{e.message || '—'}</span>,
                        e.count.toLocaleString(), e.lastSeen ? new Date(e.lastSeen).toLocaleString() : '—',
                      ])} />
                  )}
                </Section>
              )}

              {(data.instances?.length || pe.instances) && (
                <Section title={t('serviceDetail.instances')} count={data.instances?.length} error={pe.instances}>
                  {(data.instances?.length ?? 0) > 0 && (
                    <Table right={[1, 2, 3]}
                      head={[t('serviceDetail.instance'), unit === 'rpm' ? t('table.rpm') : t('table.rps'), t('serviceDetail.avg'), t('table.errors')]}
                      rows={data.instances!.map((x) => [x.name, n(x.rps) ? fmtRate(x.rps, unit) : '—', n(x.avgMs) ? fmtMs(x.avgMs) : '—', n(x.errorRate) ? fmtPct(x.errorRate) : '—'])} />
                  )}
                </Section>
              )}

              {data.tables?.map((tb, i) => (
                <Section key={i} title={tb.title} count={tb.rows?.length ?? 0}>
                  <Table head={tb.header ?? []} rows={tb.rows ?? []} />
                </Section>
              ))}

              {other.length > 0 && (
                <Section title={t('serviceDetail.more')}>
                  <div className="grid gap-3 lg:grid-cols-2">{other.map((c, i) => renderChart(c, std.length + i))}</div>
                </Section>
              )}

              {charts.length === 0 && !data.endpoints?.length && !data.errors?.length && !data.tables?.length && !data.checks?.length && Object.keys(pe).length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t('serviceDetail.empty')}</p>
              )}
              {(data.notes?.length ?? 0) > 0 && (
                <p className="text-[11px] text-muted-foreground">{data.notes!.map((x) => noteText(x, t)).join(' · ')}</p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
