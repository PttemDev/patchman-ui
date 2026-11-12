import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rabbit, ExternalLink, LayoutDashboard, ListOrdered, Shuffle, Plug, Network, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { rabbitAPI } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import type { RabbitMessageStats, RabbitRate, Tab } from '@/types';
import { useRabbitConn, useTick } from './useRabbit';
import { Bar, ErrorBanner, Loading, RefreshControl, StatTile } from './RabbitUI';
import { fmtBytes, fmtDuration, fmtNum, fmtRate, rateOf, rateSeries, samplePoints, statsOf } from './rabbitUtil';
import { QueuesSection } from './QueuesSection';
import { ExchangesSection } from './ExchangesSection';
import { ConnectionsSection } from './ConnectionsSection';
import { TopologySection } from './TopologySection';

type Section = NonNullable<Tab['rabbitSection']>;

interface OverviewData {
  overview: {
    rabbitmq_version?: string; erlang_version?: string; cluster_name?: string; management_version?: string;
    message_stats?: RabbitMessageStats;
    queue_totals?: { messages?: number; messages_ready?: number; messages_unacknowledged?: number } & Record<string, unknown>;
    object_totals?: { connections?: number; channels?: number; exchanges?: number; queues?: number; consumers?: number };
    listeners?: Array<{ node: string; protocol: string; ip_address: string; port: number }>;
    rates_mode?: string;
    disable_stats?: boolean;
  };
  nodes?: Array<{
    name: string; type?: string; running?: boolean; uptime?: number; mem_used?: number; mem_limit?: number; mem_alarm?: boolean;
    disk_free?: number; disk_free_limit?: number; disk_free_alarm?: boolean; fd_used?: number; fd_total?: number;
    sockets_used?: number; sockets_total?: number; proc_used?: number; proc_total?: number; partitions?: string[];
  }>;
  nodesError?: string;
  vhosts: Array<{ name: string; description?: string; messages?: number; messages_ready?: number; messages_unacknowledged?: number; default_queue_type?: string; message_stats?: RabbitMessageStats }>;
  whoami?: { name?: string; tags?: string[] | string };
}

const SECTIONS: Array<{ id: Section; icon: React.ElementType }> = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'queues', icon: ListOrdered },
  { id: 'exchanges', icon: Shuffle },
  { id: 'connections', icon: Plug },
  { id: 'topology', icon: Network },
];

export function ClusterView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('rabbit');
  const updateTab = useRequestStore((s) => s.updateTab);
  const connId = tab.rabbitConnectionId ?? '';
  const { conn, scope, writable, loaded } = useRabbitConn(connId);
  const section: Section = tab.rabbitSection ?? 'overview';
  const vhost = tab.rabbitVhost ?? '';
  const tick = useTick(tab.rabbitRefresh);
  const [manual, setManual] = useState(0);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      const res = await rabbitAPI.overview(conn.id, scope);
      setData(res.data as OverviewData);
      setError('');
    } catch (e) {
      setError(rabbitError(e).message);
    }
    setLoading(false);
  }, [conn, scope]);

  useEffect(() => { void load(); }, [load, manual, section === 'overview' ? tick : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (u: Partial<Tab>) => updateTab(tab.id, u);
  const totals = data?.overview.object_totals ?? {};
  const counts: Partial<Record<Section, number | undefined>> = { queues: totals.queues, exchanges: totals.exchanges, connections: totals.connections };
  const vhosts = useMemo(() => (data?.vhosts ?? []).map((v) => v.name).sort(), [data]);

  if (!connId) return <div className="p-6 text-sm text-muted-foreground">{t('missing')}</div>;
  if (loaded && !conn) return <div className="p-6 text-sm text-muted-foreground">{t('connectionGone')}</div>;

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="shrink-0 border-b px-3 pt-2 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Rabbit className="h-4 w-4 text-orange-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold truncate">{conn?.name ?? tab.name}</h2>
              {data && <span className="text-[11px] text-muted-foreground truncate">RabbitMQ {data.overview.rabbitmq_version} · {data.overview.cluster_name}</span>}
            </div>
          </div>
          {section !== 'overview' && section !== 'connections' && (
            <Select value={vhost || '__all'} onValueChange={(v) => set({ rabbitVhost: v === '__all' ? '' : v })}>
              <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {section !== 'topology' && <SelectItem value="__all">{t('vhost.all')}</SelectItem>}
                {vhosts.map((v) => <SelectItem key={v} value={v}><span className="font-mono">{v}</span></SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <RefreshControl value={tab.rabbitRefresh ?? ''} onChange={(v) => set({ rabbitRefresh: v })} onRefresh={() => setManual((n) => n + 1)} loading={loading} />
          {conn && (
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" title={t('sidebar.openManagement')} onClick={() => window.open(conn.url.replace(/\/+$/, ''), '_blank', 'noopener')}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1 -mb-px">
          {SECTIONS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => set({ rabbitSection: id, ...(id === 'topology' && !vhost ? { rabbitVhost: vhosts.includes('/') ? '/' : vhosts[0] ?? '/' } : {}) })}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-b-2 transition-colors', section === id ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`section.${id}`)}
              {counts[id] != null && <span className="text-[10px] text-muted-foreground/70 tabular-nums">{fmtNum(counts[id])}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {!conn ? <Loading /> : section === 'overview' ? (
          error && !data ? <div className="p-4"><ErrorBanner message={error} onRetry={() => setManual((n) => n + 1)} /></div>
            : !data ? <Loading /> : <OverviewSection data={data} onOpenVhost={(v) => set({ rabbitSection: 'queues', rabbitVhost: v })} />
        ) : section === 'queues' ? (
          <QueuesSection conn={conn} scope={scope} vhost={vhost} vhosts={vhosts} writable={writable} tick={tick + manual} />
        ) : section === 'exchanges' ? (
          <ExchangesSection conn={conn} scope={scope} vhost={vhost} vhosts={vhosts} writable={writable} tick={tick + manual} />
        ) : section === 'connections' ? (
          <ConnectionsSection conn={conn} scope={scope} writable={writable} tick={tick + manual} />
        ) : (
          <TopologySection conn={conn} scope={scope} vhost={vhost || '/'} tick={tick + manual} />
        )}
      </div>
    </div>
  );
}

const COLORS = { publish: '#5794F2', deliver: '#73BF69', ack: '#FADE2A', redeliver: '#FF9830', unroutable: '#F2495C', ready: '#5794F2', unacked: '#FF9830' };

function OverviewSection({ data, onOpenVhost }: { data: OverviewData; onOpenVhost: (v: string) => void }) {
  const { t } = useTranslation('rabbit');
  const ov = data.overview;
  const ms = ov.message_stats;
  const qt = ov.queue_totals ?? {};
  const tot = ov.object_totals ?? {};
  const alarms = (data.nodes ?? []).filter((n) => n.mem_alarm || n.disk_free_alarm || n.running === false || (n.partitions?.length ?? 0) > 0);
  const hasRates = !!ms && Object.keys(ms).length > 0;
  const rateSeriesList = [
    { key: 'publish', name: t('rates.publish'), color: COLORS.publish, points: rateSeries(statsOf(ms, 'publish_details')) },
    { key: 'deliver', name: t('rates.deliver'), color: COLORS.deliver, points: rateSeries(statsOf(ms, 'deliver_get_details')) },
    { key: 'ack', name: t('rates.ack'), color: COLORS.ack, points: rateSeries(statsOf(ms, 'ack_details')) },
    { key: 'redeliver', name: t('rates.redeliver'), color: COLORS.redeliver, points: rateSeries(statsOf(ms, 'redeliver_details')) },
    { key: 'unroutable', name: t('rates.unroutable'), color: COLORS.unroutable, points: rateSeries(statsOf(ms, 'drop_unroutable_details')) },
  ].filter((s) => s.points.length > 1);
  const lenSeries = [
    { key: 'ready', name: t('queue.ready'), color: COLORS.ready, points: samplePoints(qt.messages_ready_details as RabbitRate | undefined) },
    { key: 'unacked', name: t('queue.unacked'), color: COLORS.unacked, points: samplePoints(qt.messages_unacknowledged_details as RabbitRate | undefined) },
  ].filter((s) => s.points.length > 1);

  return (
    <div className="p-3 space-y-3">
      {alarms.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {alarms.map((n) => (
              <div key={n.name}>
                <span className="font-mono">{n.name}</span>:{' '}
                {[n.running === false && t('nodes.down'), n.mem_alarm && t('nodes.memAlarm'), n.disk_free_alarm && t('nodes.diskAlarm'), (n.partitions?.length ?? 0) > 0 && t('nodes.partition')].filter(Boolean).join(' · ')}
              </div>
            ))}
            <div className="text-xs opacity-80">{t('nodes.alarmHint')}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
        <StatTile label={t('queue.ready')} value={fmtNum(qt.messages_ready)} />
        <StatTile label={t('queue.unacked')} value={fmtNum(qt.messages_unacknowledged)} />
        <StatTile label={t('rates.publish')} value={hasRates ? `${fmtRate(rateOf(ms, 'publish_details'))}/s` : '–'} />
        <StatTile label={t('rates.deliver')} value={hasRates ? `${fmtRate(rateOf(ms, 'deliver_get_details'))}/s` : '–'} />
        <StatTile label={t('section.queues')} value={fmtNum(tot.queues)} />
        <StatTile label={t('section.connections')} value={fmtNum(tot.connections)} sub={`${fmtNum(tot.channels)} ${t('conn.channels')}`} />
        <StatTile label={t('queue.consumers')} value={fmtNum(tot.consumers)} />
        <StatTile label={t('section.exchanges')} value={fmtNum(tot.exchanges)} />
      </div>

      {!hasRates && (
        <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('rates.none')}
        </div>
      )}

      {(rateSeriesList.length > 0 || lenSeries.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-3">
          {rateSeriesList.length > 0 && (
            <div className="rounded-md border bg-card p-2">
              <div className="text-xs font-medium mb-1">{t('charts.rates')}</div>
              <div className="h-48"><TimeSeriesChart series={rateSeriesList} format={(v) => `${fmtRate(v)}/s`} fillOpacity={10} legend="list" /></div>
            </div>
          )}
          {lenSeries.length > 0 && (
            <div className="rounded-md border bg-card p-2">
              <div className="text-xs font-medium mb-1">{t('charts.queued')}</div>
              <div className="h-48"><TimeSeriesChart series={lenSeries} format={(v) => fmtNum(v)} fillOpacity={20} stack="normal" legend="list" /></div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border bg-card">
        <div className="px-3 py-2 text-xs font-medium border-b">{t('nodes.title')}</div>
        {data.nodesError ? (
          <div className="p-3 text-xs text-muted-foreground">{t('nodes.unavailable')} <span className="opacity-70">({data.nodesError})</span></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="font-medium px-3 py-1.5">{t('nodes.name')}</th>
                  <th className="font-medium px-2 py-1.5">{t('nodes.uptime')}</th>
                  <th className="font-medium px-2 py-1.5 w-[22%]">{t('nodes.memory')}</th>
                  <th className="font-medium px-2 py-1.5 w-[22%]">{t('nodes.disk')}</th>
                  <th className="font-medium px-2 py-1.5">{t('nodes.fds')}</th>
                  <th className="font-medium px-2 py-1.5">{t('nodes.processes')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.nodes ?? []).map((n) => (
                  <tr key={n.name} className="border-t border-border/50">
                    <td className="px-3 py-1.5 font-mono">
                      <span className={cn('inline-block h-2 w-2 rounded-full mr-1.5', n.running === false ? 'bg-destructive' : 'bg-emerald-500')} />
                      {n.name}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{n.uptime ? fmtDuration(n.uptime) : '–'}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-between gap-2 tabular-nums"><span>{fmtBytes(n.mem_used)}</span><span className="text-muted-foreground">{t('nodes.limit')} {fmtBytes(n.mem_limit)}</span></div>
                      <Bar used={n.mem_used ?? 0} total={n.mem_limit ?? 0} alarm={n.mem_alarm} />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-between gap-2 tabular-nums"><span>{fmtBytes(n.disk_free)} {t('nodes.free')}</span><span className="text-muted-foreground">{t('nodes.limit')} {fmtBytes(n.disk_free_limit)}</span></div>
                      <Bar used={n.disk_free_limit ?? 0} total={n.disk_free ?? 0} alarm={n.disk_free_alarm} />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(n.fd_used)} / {fmtNum(n.fd_total)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(n.proc_used)} / {fmtNum(n.proc_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-md border bg-card">
          <div className="px-3 py-2 text-xs font-medium border-b">{t('vhost.title')}</div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="font-medium px-3 py-1.5">{t('vhost.name')}</th>
                <th className="font-medium px-2 py-1.5 text-right">{t('queue.ready')}</th>
                <th className="font-medium px-2 py-1.5 text-right">{t('queue.unacked')}</th>
                <th className="font-medium px-2 py-1.5 text-right">{t('rates.publish')}</th>
              </tr>
            </thead>
            <tbody>
              {data.vhosts.map((v) => (
                <tr key={v.name} className="border-t border-border/50 hover:bg-accent/30 cursor-pointer" onClick={() => onOpenVhost(v.name)}>
                  <td className="px-3 py-1.5 font-mono">{v.name}{v.description && <span className="ml-2 font-sans text-muted-foreground">{v.description}</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(v.messages_ready)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(v.messages_unacknowledged)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtRate(rateOf(v.message_stats, 'publish_details'))}/s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-md border bg-card">
          <div className="px-3 py-2 text-xs font-medium border-b">{t('listeners.title')}</div>
          <div className="p-2 flex flex-wrap gap-1.5">
            {(ov.listeners ?? []).map((l) => (
              <span key={`${l.node}-${l.protocol}-${l.port}`} className="rounded border px-1.5 py-0.5 text-[11px] font-mono" title={l.node}>
                {l.protocol} :{l.port}
              </span>
            ))}
          </div>
          <div className="px-3 pb-2 text-[11px] text-muted-foreground">
            Erlang {ov.erlang_version} · {t('listeners.management')} {ov.management_version}
            {data.whoami?.name && <> · {t('listeners.user')} <span className="font-mono">{data.whoami.name}</span> ({Array.isArray(data.whoami.tags) ? data.whoami.tags.join(', ') : data.whoami.tags})</>}
          </div>
        </div>
      </div>
    </div>
  );
}
