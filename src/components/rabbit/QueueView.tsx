import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Inbox, Waves, ExternalLink, MoreVertical, Eraser, ArrowRightLeft, Trash2, Send, Eye, Info, AlertTriangle, Loader2, Plus, Link2Off, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { rabbitAPI } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import type { RabbitBinding, RabbitMessage, RabbitPeekInfo, RabbitQueue, Tab } from '@/types';
import { useRabbitConn, useTick } from './useRabbit';
import { Chip, ErrorBanner, Loading, RefreshControl, StatTile, TypeBadge } from './RabbitUI';
import { MessageList } from './MessageList';
import { PublishForm } from './PublishForm';
import { BindDialog, ConfirmDialog, MoveDialog } from './RabbitDialogs';
import {
  extractErr, fmtBytes, fmtNum, fmtRate, managementLink, openRabbitExchange, queueSetting, rateOf, rateSeries, samplePoints, statsOf,
} from './rabbitUtil';

interface QueueDetail { queue: RabbitQueue; bindings: RabbitBinding[]; peek: RabbitPeekInfo }

type Pane = 'messages' | 'publish' | 'consumers' | 'bindings';
const PANES: Pane[] = ['messages', 'publish', 'consumers', 'bindings'];

export function QueueView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('rabbit');
  const { toast } = useToast();
  const updateTab = useRequestStore((s) => s.updateTab);
  const { conn, scope, writable, loaded } = useRabbitConn(tab.rabbitConnectionId);
  const vhost = tab.rabbitVhost ?? '/';
  const name = tab.rabbitQueue ?? '';
  const pane = (PANES.includes(tab.rabbitPane as Pane) ? tab.rabbitPane : 'messages') as Pane;
  const tick = useTick(tab.rabbitRefresh);
  const [manual, setManual] = useState(0);
  const [d, setD] = useState<QueueDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<'purge' | 'move' | 'delete' | 'bind' | null>(null);
  const [unbinding, setUnbinding] = useState<RabbitBinding | null>(null);

  const load = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      const res = await rabbitAPI.queue(conn.id, vhost, name, scope);
      setD(res.data as QueueDetail);
      setError('');
    } catch (e) {
      setError(rabbitError(e).message);
    }
    setLoading(false);
  }, [conn, scope, vhost, name]);
  useEffect(() => { void load(); }, [load, tick, manual]);

  if (loaded && !conn) return <div className="p-6 text-sm text-muted-foreground">{t('connectionGone')}</div>;
  if (!conn || (!d && !error)) return <Loading />;
  if (!d) return <div className="p-4"><ErrorBanner message={error} onRetry={load} /></div>;

  const q = d.queue;
  const ms = q.message_stats;
  const dlx = queueSetting(q, 'dead-letter-exchange');
  const dlrk = queueSetting(q, 'dead-letter-routing-key');
  const ttl = queueSetting(q, 'message-ttl');
  const maxLen = queueSetting(q, 'max-length');
  const maxBytes = queueSetting(q, 'max-length-bytes');
  const overflow = queueSetting(q, 'overflow');
  const expires = queueSetting(q, 'expires');
  const stuck = q.type !== 'stream' && (q.messages ?? 0) > 0 && (q.consumers ?? 0) === 0;
  const set = (u: Partial<Tab>) => updateTab(tab.id, u);
  const Icon = q.type === 'stream' ? Waves : Inbox;

  const lenSeries = [
    { key: 'ready', name: t('queue.ready'), color: '#5794F2', points: samplePoints(q.messages_ready_details) },
    { key: 'unacked', name: t('queue.unacked'), color: '#FF9830', points: samplePoints(q.messages_unacknowledged_details) },
  ].filter((s) => s.points.length > 1);
  const rates = [
    { key: 'publish', name: t('rates.publish'), color: '#5794F2', points: rateSeries(statsOf(ms, 'publish_details')) },
    { key: 'deliver', name: t('rates.deliver'), color: '#73BF69', points: rateSeries(statsOf(ms, 'deliver_get_details')) },
    { key: 'ack', name: t('rates.ack'), color: '#FADE2A', points: rateSeries(statsOf(ms, 'ack_details')) },
    { key: 'redeliver', name: t('rates.redeliver'), color: '#FF9830', points: rateSeries(statsOf(ms, 'redeliver_details')) },
  ].filter((s) => s.points.length > 1);

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="shrink-0 border-b px-3 pt-2 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn('h-4 w-4 shrink-0', q.type === 'quorum' ? 'text-emerald-500' : q.type === 'stream' ? 'text-sky-500' : 'text-orange-500')} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold font-mono truncate" title={q.name}>{q.name}</h2>
              <TypeBadge type={q.type} />
              {q.state && <span className={cn('text-[10px]', q.state === 'running' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>{q.state}</span>}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {conn.name} · vhost <span className="font-mono">{vhost}</span>{q.node && <> · {q.leader ? t('queue.leader') : t('queue.node')} <span className="font-mono">{q.leader ?? q.node}</span></>}
              {q.members && q.members.length > 1 && <> · {t('queue.members', { count: q.members.length })}</>}
            </div>
          </div>
          <RefreshControl value={tab.rabbitRefresh ?? ''} onChange={(v) => set({ rabbitRefresh: v })} onRefresh={() => setManual((n) => n + 1)} loading={loading} />
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" title={t('sidebar.openManagement')} onClick={() => window.open(managementLink(conn.url, 'queues', vhost, name), '_blank', 'noopener')}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0"><MoreVertical className="h-3.5 w-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => set({ rabbitPane: 'messages' })}><Eye className="h-3.5 w-3.5 mr-2" /> {t('queue.readMessages')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!writable} onClick={() => set({ rabbitPane: 'publish' })}><Send className="h-3.5 w-3.5 mr-2" /> {t('pane.publish')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!writable || q.type === 'stream'} onClick={() => setDialog('move')}><ArrowRightLeft className="h-3.5 w-3.5 mr-2" /> {t('move.action')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!writable} onClick={() => setDialog('purge')} className="text-destructive focus:text-destructive"><Eraser className="h-3.5 w-3.5 mr-2" /> {t('queue.purge')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!writable} onClick={() => setDialog('delete')} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> {t('queue.delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {q.durable === false && <Chip tone="warn">{t('queue.transient')}</Chip>}
          {q.exclusive && <Chip>{t('queue.exclusive')}</Chip>}
          {q.auto_delete && <Chip>{t('dialogs.autoDelete')}</Chip>}
          {dlx != null && (
            <button type="button" onClick={() => openRabbitExchange(conn.id, vhost, String(dlx))}>
              <Chip tone="bad" title={t('queue.dlx')}>DLX → {String(dlx) || '(default)'}{dlrk != null ? ` · ${String(dlrk)}` : ''}</Chip>
            </button>
          )}
          {ttl != null && <Chip tone="info">TTL {fmtNum(Number(ttl))} ms</Chip>}
          {expires != null && <Chip>{t('queue.expires')} {fmtNum(Number(expires))} ms</Chip>}
          {maxLen != null && <Chip>{t('queue.maxLength')} {fmtNum(Number(maxLen))}{overflow ? ` · ${String(overflow)}` : ''}</Chip>}
          {maxBytes != null && <Chip>{t('queue.maxBytes')} {fmtBytes(Number(maxBytes))}</Chip>}
          {d.peek.deliveryLimit ? <Chip tone={d.peek.risk === 'delivery_limit' ? 'warn' : undefined}>{t('queue.deliveryLimit')} {d.peek.deliveryLimit}</Chip> : null}
          {q.policy && <Chip title={JSON.stringify(q.effective_policy_definition)}>{t('queue.policy')}: {q.policy}</Chip>}
          {q.arguments?.['x-single-active-consumer'] === true && <Chip>{t('queue.sac')}</Chip>}
        </div>
        <div className="flex items-center gap-1 -mb-px">
          {PANES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set({ rabbitPane: p })}
              className={cn('px-2.5 py-1.5 text-xs border-b-2 transition-colors', pane === p ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t(`pane.${p}`)}
              {p === 'consumers' && <span className="ml-1 text-[10px] text-muted-foreground/70">{q.consumers ?? 0}</span>}
              {p === 'bindings' && <span className="ml-1 text-[10px] text-muted-foreground/70">{d.bindings.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        <div className="grid grid-cols-3 sm:grid-cols-6 xl:grid-cols-9 gap-2">
          <StatTile label={t('queue.ready')} value={fmtNum(q.messages_ready)} tone={stuck ? 'warn' : undefined} title={stuck ? t('queues.noConsumer') : undefined} />
          <StatTile label={t('queue.unacked')} value={fmtNum(q.messages_unacknowledged)} />
          <StatTile label={t('queue.total')} value={fmtNum(q.messages)} sub={fmtBytes(q.message_bytes)} />
          <StatTile label={t('queue.consumers')} value={fmtNum(q.consumers)} tone={stuck ? 'warn' : undefined} sub={q.consumer_utilisation != null ? `${Math.round((q.consumer_utilisation ?? 0) * 100)}% ${t('queue.utilisation')}` : undefined} />
          <StatTile label={t('rates.publish')} value={`${fmtRate(rateOf(ms, 'publish_details'))}/s`} />
          <StatTile label={t('rates.deliver')} value={`${fmtRate(rateOf(ms, 'deliver_get_details'))}/s`} />
          <StatTile label={t('rates.ack')} value={`${fmtRate(rateOf(ms, 'ack_details'))}/s`} />
          <StatTile label={t('rates.redeliver')} value={`${fmtRate(rateOf(ms, 'redeliver_details'))}/s`} tone={(rateOf(ms, 'redeliver_details') ?? 0) > 0 ? 'warn' : undefined} />
          <StatTile label={t('queues.memory')} value={fmtBytes(q.memory)} />
        </div>
        {(lenSeries.length > 0 || rates.length > 0) && (
          <div className="grid lg:grid-cols-2 gap-3">
            {lenSeries.length > 0 && (
              <div className="rounded-md border bg-card p-2">
                <div className="text-xs font-medium mb-1">{t('charts.queued')}</div>
                <div className="h-40"><TimeSeriesChart series={lenSeries} format={(v) => fmtNum(v)} fillOpacity={20} stack="normal" legend="list" /></div>
              </div>
            )}
            {rates.length > 0 && (
              <div className="rounded-md border bg-card p-2">
                <div className="text-xs font-medium mb-1">{t('charts.rates')}</div>
                <div className="h-40"><TimeSeriesChart series={rates} format={(v) => `${fmtRate(v)}/s`} fillOpacity={10} legend="list" /></div>
              </div>
            )}
          </div>
        )}

        {pane === 'messages' && (
          <MessagesPane connId={conn.id} scope={scope} vhost={vhost} queue={q} peek={d.peek} writable={writable} onChanged={() => setManual((n) => n + 1)} />
        )}
        {pane === 'publish' && (
          <PublishForm conn={conn} scope={scope} vhost={vhost} exchange="" routingKey={name} lockKey writable={writable} onPublished={() => setManual((n) => n + 1)} />
        )}
        {pane === 'consumers' && (
          <div className="rounded-md border bg-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left bg-muted/30">
                <tr>
                  <th className="font-medium pl-3 pr-2 py-1.5">{t('consumers.tag')}</th>
                  <th className="font-medium px-2 py-1.5">{t('consumers.client')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.from')}</th>
                  <th className="font-medium px-2 py-1.5">{t('consumers.ack')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('conn.prefetch')}</th>
                  <th className="font-medium pl-2 pr-3 py-1.5">{t('consumers.status')}</th>
                </tr>
              </thead>
              <tbody>
                {(q.consumer_details ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('consumers.none')}</td></tr>}
                {(q.consumer_details ?? []).map((c) => (
                  <tr key={`${c.consumer_tag}|${c.channel_details?.name}`} className="border-t border-border/50">
                    <td className="pl-3 pr-2 py-1.5 font-mono truncate max-w-[260px]" title={c.consumer_tag}>{c.consumer_tag}</td>
                    <td className="px-2 py-1.5 truncate max-w-[260px]">{c.channel_details?.connection_name}</td>
                    <td className="px-2 py-1.5 font-mono">{c.channel_details?.peer_host}:{c.channel_details?.peer_port}</td>
                    <td className="px-2 py-1.5">{c.ack_required ? t('consumers.manual') : t('consumers.auto')}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.prefetch_count === 0 ? '∞' : fmtNum(c.prefetch_count)}</td>
                    <td className="pl-2 pr-3 py-1.5">{c.activity_status ?? (c.active === false ? 'waiting' : 'up')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pane === 'bindings' && (
          <div className="space-y-2">
            {writable && <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setDialog('bind')}><Plus className="h-3.5 w-3.5" /> {t('dialogs.newBinding')}</Button>}
            <div className="rounded-md border bg-card overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left bg-muted/30">
                  <tr>
                    <th className="font-medium pl-3 pr-2 py-1.5">{t('bindings.source')}</th>
                    <th className="font-medium px-2 py-1.5">{t('bindings.routingKey')}</th>
                    <th className="font-medium px-2 py-1.5">{t('bindings.arguments')}</th>
                    {writable && <th className="pr-3" />}
                  </tr>
                </thead>
                <tbody>
                  {d.bindings.map((b) => (
                    <tr key={`${b.source}|${b.properties_key}`} className="border-t border-border/50">
                      <td className="pl-3 pr-2 py-1.5">
                        <button type="button" className="font-mono hover:underline" onClick={() => openRabbitExchange(conn.id, vhost, b.source)}>{b.source || t('exchange.default')}</button>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{b.routing_key}</td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">{b.arguments && Object.keys(b.arguments).length ? JSON.stringify(b.arguments) : ''}</td>
                      {writable && (
                        <td className="pr-3 py-1.5 text-right">
                          {b.source && (
                            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setUnbinding(b)}><Link2Off className="h-3.5 w-3.5 mr-1" /> {t('bindings.unbind')}</Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">{t('bindings.defaultNote')}</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={dialog === 'purge'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('queue.purgeTitle', { name })}
        description={t('queue.purgeDescription', { count: q.messages_ready ?? 0 })}
        confirmText={t('queue.purge')}
        typeToConfirm={(q.messages ?? 0) > 0 ? name : undefined}
        danger
        onConfirm={async () => { await rabbitAPI.purge(conn.id, vhost, name, scope); toast({ title: t('queue.purged') }); setManual((n) => n + 1); }}
      />
      <DeleteQueueDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} name={name} type={q.type} onConfirm={async (opts) => {
        await rabbitAPI.deleteQueue(conn.id, vhost, name, opts, scope);
        toast({ title: t('queue.deleted') });
      }} />
      <MoveDialog
        open={dialog === 'move'}
        onOpenChange={(o) => !o && setDialog(null)}
        conn={conn}
        scope={scope}
        vhost={vhost}
        source={name}
        available={q.messages_ready ?? 0}
        onDone={(moved, stopped) => {
          toast({ title: t('move.done', { count: moved }), description: stopped, variant: stopped ? 'destructive' : undefined });
          setManual((n) => n + 1);
        }}
      />
      <BindDialog open={dialog === 'bind'} onOpenChange={(o) => !o && setDialog(null)} conn={conn} scope={scope} vhost={vhost} destination={name} destinationType="queue" onDone={() => setManual((n) => n + 1)} />
      <ConfirmDialog
        open={!!unbinding}
        onOpenChange={(o) => !o && setUnbinding(null)}
        title={t('bindings.unbindTitle')}
        description={t('bindings.unbindDescription', { source: unbinding?.source, key: unbinding?.routing_key })}
        confirmText={t('bindings.unbind')}
        danger
        onConfirm={async () => {
          if (!unbinding) return;
          await rabbitAPI.unbind(conn.id, { vhost, source: unbinding.source, destination: name, destinationType: 'queue', routingKey: unbinding.routing_key, propertiesKey: unbinding.properties_key }, scope);
          setManual((n) => n + 1);
        }}
      />
    </div>
  );
}

function DeleteQueueDialog({ open, onOpenChange, name, type, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; type?: string; onConfirm: (o: { ifEmpty?: boolean; ifUnused?: boolean }) => Promise<void>;
}) {
  const { t } = useTranslation('rabbit');
  const [ifEmpty, setIfEmpty] = useState(true);
  const [ifUnused, setIfUnused] = useState(true);
  // RabbitMQ only supports conditional deletes on classic queues (quorum:
  // neither flag; stream: if-unused only).
  const classic = !type || type === 'classic';
  const stream = type === 'stream';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('queue.deleteTitle', { name })}
      description={t('queue.deleteDescription')}
      confirmText={t('queue.delete')}
      typeToConfirm={name}
      danger
      onConfirm={() => onConfirm({ ifEmpty: classic && ifEmpty, ifUnused: (classic || stream) && ifUnused })}
    >
      <div className="space-y-1.5 text-xs">
        {classic && <label className="flex items-center gap-2"><input type="checkbox" checked={ifEmpty} onChange={(e) => setIfEmpty(e.target.checked)} /> {t('queue.ifEmpty')}</label>}
        {(classic || stream) && <label className="flex items-center gap-2"><input type="checkbox" checked={ifUnused} onChange={(e) => setIfUnused(e.target.checked)} /> {t('queue.ifUnused')}</label>}
        {!classic && <p className="text-[11px] text-muted-foreground">{t('queue.noConditional', { type })}</p>}
      </div>
    </ConfirmDialog>
  );
}

function MessagesPane({ connId, scope, vhost, queue, peek, writable, onChanged }: {
  connId: string; scope: 'local' | 'remote'; vhost: string; queue: RabbitQueue; peek: RabbitPeekInfo; writable: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation('rabbit');
  const { toast } = useToast();
  const [count, setCount] = useState('10');
  const [offsetMode, setOffsetMode] = useState('first');
  const [offsetValue, setOffsetValue] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<RabbitMessage[] | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const stream = peek.mode === 'stream';
  const risky = peek.risk === 'delivery_limit';

  const read = async () => {
    setBusy(true);
    setError('');
    try {
      if (stream) {
        const offset = offsetMode === 'offset' ? offsetValue.trim() : offsetMode === 'time' ? new Date(offsetValue).toISOString() : offsetMode;
        const res = await rabbitAPI.streamRead(connId, { vhost, queue: queue.name, offset, count: Number(count) || 10 }, scope);
        setMsgs((res.data as RabbitMessage[]) ?? []);
      } else {
        const res = await rabbitAPI.getMessages(connId, { vhost, queue: queue.name, count: Number(count) || 10, truncate: 50000 }, scope);
        setMsgs((res.data as RabbitMessage[]) ?? []);
        onChanged();
      }
    } catch (e) {
      setError(extractErr(e, t('messages.failed')));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      {stream ? (
        <div className="flex gap-1.5 rounded bg-sky-500/10 p-2 text-[11px] text-sky-800 dark:text-sky-200">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('messages.streamNote')}
        </div>
      ) : risky ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive space-y-1.5">
          <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('messages.limitWarning', { limit: peek.deliveryLimit, version: peek.version, dlx: peek.hasDlx ? t('messages.toDlx') : t('messages.dropped') })}</div>
          <label className="flex items-center gap-2 pl-5"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> {t('messages.acceptRisk')}</label>
        </div>
      ) : (
        <div className="flex gap-1.5 rounded bg-muted/60 p-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('messages.requeueNote')}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {stream && (
          <>
            <Select value={offsetMode} onValueChange={setOffsetMode}>
              <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['first', 'last', 'offset', 'time'].map((m) => <SelectItem key={m} value={m}>{t(`messages.offset_${m}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            {offsetMode === 'offset' && <Input value={offsetValue} onChange={(e) => setOffsetValue(e.target.value.replace(/\D/g, ''))} className="h-7 w-28 text-xs font-mono" placeholder="0" />}
            {offsetMode === 'time' && <Input type="datetime-local" value={offsetValue} onChange={(e) => setOffsetValue(e.target.value)} className="h-7 w-[200px] text-xs" />}
          </>
        )}
        <span className="text-xs text-muted-foreground">{t('messages.countLabel')}</span>
        <Input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} className="h-7 w-16 text-xs font-mono" />
        <Button size="sm" className="h-7 text-xs gap-1" onClick={read} disabled={busy || (risky && !accept) || (stream && (offsetMode === 'offset' || offsetMode === 'time') && !offsetValue)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {stream ? t('messages.readStream') : t('messages.peek')}
        </Button>
        {!stream && writable && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setRemoving(true)}>
            <Trash2 className="h-3.5 w-3.5" /> {t('messages.getRemove')}
          </Button>
        )}
        {!writable && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Lock className="h-3 w-3" /> {t('readOnlyShort')}</span>}
      </div>
      {error && <ErrorBanner message={error} />}
      {msgs && <MessageList messages={msgs} fileName={`${queue.name}-messages`} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('messages.removeTitle', { count: Number(count) || 10 })}
        description={t('messages.removeDescription')}
        confirmText={t('messages.getRemove')}
        danger
        onConfirm={async () => {
          const res = await rabbitAPI.getMessages(connId, { vhost, queue: queue.name, count: Number(count) || 10, remove: true, truncate: 50000 }, scope);
          const got = (res.data as RabbitMessage[]) ?? [];
          setMsgs(got);
          toast({ title: t('messages.removed', { count: got.length }) });
          onChanged();
        }}
      />
    </div>
  );
}
