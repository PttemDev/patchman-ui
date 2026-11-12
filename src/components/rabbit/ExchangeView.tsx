import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shuffle, ExternalLink, MoreVertical, Trash2, Plus, Link2Off, Play, Square, Pause, Eraser, Info, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { rabbitAPI, type DBScope } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import type { RabbitBinding, RabbitConnection, RabbitExchange, RabbitMessage, Tab } from '@/types';
import { useRabbitConn, useTick } from './useRabbit';
import { Chip, ErrorBanner, Loading, RefreshControl, StatTile, TypeBadge } from './RabbitUI';
import { MessageList } from './MessageList';
import { PublishForm } from './PublishForm';
import { BindDialog, ConfirmDialog } from './RabbitDialogs';
import { fmtNum, fmtRate, managementLink, openRabbitExchange, openRabbitQueue, rateOf, rateSeries, statsOf } from './rabbitUtil';

interface ExchangeDetail { exchange: RabbitExchange; source: RabbitBinding[]; destination: RabbitBinding[] }
type Pane = 'bindings' | 'publish' | 'tail';
const PANES: Pane[] = ['bindings', 'publish', 'tail'];

export function ExchangeView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('rabbit');
  const { toast } = useToast();
  const updateTab = useRequestStore((s) => s.updateTab);
  const { conn, scope, writable, loaded } = useRabbitConn(tab.rabbitConnectionId);
  const vhost = tab.rabbitVhost ?? '/';
  const name = tab.rabbitExchange ?? '';
  const pane = (PANES.includes(tab.rabbitPane as Pane) ? tab.rabbitPane : 'bindings') as Pane;
  const tick = useTick(tab.rabbitRefresh);
  const [manual, setManual] = useState(0);
  const [d, setD] = useState<ExchangeDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [binding, setBinding] = useState(false);
  const [unbinding, setUnbinding] = useState<RabbitBinding | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      const res = await rabbitAPI.exchange(conn.id, vhost, name, scope);
      setD(res.data as ExchangeDetail);
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

  const e = d.exchange;
  const builtin = !name || name.startsWith('amq.');
  const set = (u: Partial<Tab>) => updateTab(tab.id, u);
  const ms = e.message_stats;
  const rates = [
    { key: 'in', name: t('queues.in'), color: '#5794F2', points: rateSeries(statsOf(ms, 'publish_in_details')) },
    { key: 'out', name: t('queues.out'), color: '#73BF69', points: rateSeries(statsOf(ms, 'publish_out_details')) },
  ].filter((s) => s.points.length > 1);

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="shrink-0 border-b px-3 pt-2 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Shuffle className="h-4 w-4 shrink-0 text-violet-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold font-mono truncate">{name || t('exchange.default')}</h2>
              <TypeBadge type={e.type} />
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{conn.name} · vhost <span className="font-mono">{vhost}</span></div>
          </div>
          <RefreshControl value={tab.rabbitRefresh ?? ''} onChange={(v) => set({ rabbitRefresh: v })} onRefresh={() => setManual((n) => n + 1)} loading={loading} />
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" title={t('sidebar.openManagement')} onClick={() => window.open(managementLink(conn.url, 'exchanges', vhost, name), '_blank', 'noopener')}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          {writable && !builtin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0"><MoreVertical className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDeleting(true)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> {t('exchange.delete')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {e.durable === false && <Chip tone="warn">{t('queue.transient')}</Chip>}
          {e.auto_delete && <Chip>{t('dialogs.autoDelete')}</Chip>}
          {e.internal && <Chip>{t('dialogs.internal')}</Chip>}
          {e.arguments?.['alternate-exchange'] != null && (
            <button type="button" onClick={() => openRabbitExchange(conn.id, vhost, String(e.arguments?.['alternate-exchange']))}><Chip tone="info">AE → {String(e.arguments?.['alternate-exchange'])}</Chip></button>
          )}
          {e.policy && <Chip>{t('queue.policy')}: {e.policy}</Chip>}
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
              {p === 'bindings' && <span className="ml-1 text-[10px] text-muted-foreground/70">{d.source.length + d.destination.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-3xl">
          <StatTile label={t('queues.in')} value={`${fmtRate(rateOf(ms, 'publish_in_details'))}/s`} />
          <StatTile label={t('queues.out')} value={`${fmtRate(rateOf(ms, 'publish_out_details'))}/s`} />
          <StatTile label={t('exchange.routesTo')} value={fmtNum(d.source.length)} />
          <StatTile label={t('exchange.boundFrom')} value={fmtNum(d.destination.length)} />
        </div>
        {rates.length > 0 && (
          <div className="rounded-md border bg-card p-2 max-w-3xl">
            <div className="text-xs font-medium mb-1">{t('charts.rates')}</div>
            <div className="h-36"><TimeSeriesChart series={rates} format={(v) => `${fmtRate(v)}/s`} fillOpacity={10} legend="list" /></div>
          </div>
        )}

        {pane === 'bindings' && (
          <div className="space-y-3">
            {!name ? (
              <div className="flex gap-1.5 rounded bg-muted/60 p-2 text-[11px] text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('exchange.defaultNote')}</div>
            ) : (
              <>
                {writable && !name.startsWith('amq.') && <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setBinding(true)}><Plus className="h-3.5 w-3.5" /> {t('dialogs.newBinding')}</Button>}
                <BindingTable
                  title={t('exchange.routesTo')}
                  rows={d.source}
                  side="destination"
                  writable={writable}
                  onOpen={(b) => (b.destination_type === 'queue' ? openRabbitQueue(conn.id, vhost, b.destination) : openRabbitExchange(conn.id, vhost, b.destination))}
                  onUnbind={setUnbinding}
                />
                <BindingTable
                  title={t('exchange.boundFrom')}
                  rows={d.destination}
                  side="source"
                  writable={writable}
                  onOpen={(b) => openRabbitExchange(conn.id, vhost, b.source)}
                  onUnbind={setUnbinding}
                />
              </>
            )}
          </div>
        )}
        {pane === 'publish' && (
          <PublishForm conn={conn} scope={scope} vhost={vhost} exchange={name} routingKey={e.type === 'topic' ? '' : ''} writable={writable} onPublished={() => setManual((n) => n + 1)} />
        )}
        {pane === 'tail' && <TailPane conn={conn} scope={scope} vhost={vhost} exchange={e} />}
      </div>

      <BindDialog open={binding} onOpenChange={setBinding} conn={conn} scope={scope} vhost={vhost} source={name} onDone={() => setManual((n) => n + 1)} />
      <ConfirmDialog
        open={!!unbinding}
        onOpenChange={(o) => !o && setUnbinding(null)}
        title={t('bindings.unbindTitle')}
        description={t('bindings.unbindDescription', { source: unbinding?.source, key: unbinding?.routing_key })}
        confirmText={t('bindings.unbind')}
        danger
        onConfirm={async () => {
          if (!unbinding) return;
          await rabbitAPI.unbind(conn.id, {
            vhost, source: unbinding.source, destination: unbinding.destination, destinationType: unbinding.destination_type,
            routingKey: unbinding.routing_key, propertiesKey: unbinding.properties_key,
          }, scope);
          setManual((n) => n + 1);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('exchange.deleteTitle', { name })}
        description={t('exchange.deleteDescription')}
        confirmText={t('exchange.delete')}
        typeToConfirm={name}
        danger
        onConfirm={async () => { await rabbitAPI.deleteExchange(conn.id, vhost, name, scope); toast({ title: t('exchange.deleted') }); }}
      />
    </div>
  );
}

function BindingTable({ title, rows, side, writable, onOpen, onUnbind }: {
  title: string; rows: RabbitBinding[]; side: 'source' | 'destination'; writable: boolean;
  onOpen: (b: RabbitBinding) => void; onUnbind: (b: RabbitBinding) => void;
}) {
  const { t } = useTranslation('rabbit');
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <div className="px-3 py-1.5 text-xs font-medium border-b">{title} <span className="text-muted-foreground font-normal">({rows.length})</span></div>
      {rows.length === 0 ? <div className="px-3 py-3 text-xs text-muted-foreground">{t('bindings.none')}</div> : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((b) => (
              <tr key={`${b.source}|${b.destination}|${b.destination_type}|${b.properties_key}`} className="border-t border-border/50 first:border-t-0">
                <td className="pl-3 pr-2 py-1.5 w-[45%]">
                  <button type="button" className="font-mono hover:underline" onClick={() => onOpen(b)}>
                    <span className="text-[10px] text-muted-foreground mr-1">{side === 'destination' ? (b.destination_type === 'queue' ? t('bindings.queue') : t('bindings.exchange')) : t('bindings.exchange')}</span>
                    {side === 'destination' ? b.destination : b.source}
                  </button>
                </td>
                <td className="px-2 py-1.5 font-mono">{b.routing_key}</td>
                <td className="px-2 py-1.5 font-mono text-muted-foreground">{b.arguments && Object.keys(b.arguments).length ? JSON.stringify(b.arguments) : ''}</td>
                {writable && (
                  <td className="pr-3 py-1.5 text-right">
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => onUnbind(b)}><Link2Off className="h-3.5 w-3.5 mr-1" /> {t('bindings.unbind')}</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const TAIL_CAP = 1000;

/** Live tail: a temporary exclusive queue bound to the exchange, streamed as SSE. */
function TailPane({ conn, scope, vhost, exchange }: { conn: RabbitConnection; scope: DBScope; vhost: string; exchange: RabbitExchange }) {
  const { t } = useTranslation('rabbit');
  const [key, setKey] = useState(exchange.type === 'topic' ? '#' : '');
  const [args, setArgs] = useState(exchange.type === 'headers' ? '{ "x-match": "any" }' : '');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [msgs, setMsgs] = useState<RabbitMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    setError('');
    if (exchange.type === 'headers' && args.trim()) {
      try { JSON.parse(args); } catch { setError(t('dialogs.argsInvalid')); return; }
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setPaused(false);
    try {
      const url = rabbitAPI.tailUrl(conn.id, { vhost, exchange: exchange.name, routingKey: key, arguments: exchange.type === 'headers' ? args.trim() : undefined }, scope);
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { msg = ((await res.json()) as { error?: string }).error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = '';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (event === 'message') {
            try {
              const m = JSON.parse(data) as RabbitMessage;
              setTotal((n) => n + 1);
              if (!pausedRef.current) setMsgs((list) => [m, ...list].slice(0, TAIL_CAP));
            } catch { /* ignore */ }
          } else if (event === 'error') {
            try { setError((JSON.parse(data) as { message: string }).message); } catch { setError(data); }
          }
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    }
    if (abortRef.current === ac) {
      abortRef.current = null;
      setRunning(false);
    }
  };

  if (!exchange.name) {
    return <div className="flex gap-1.5 rounded bg-muted/60 p-2 text-[11px] text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('tail.noDefault')}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 rounded bg-muted/60 p-2 text-[11px] text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('tail.note')}</div>
      <div className="flex flex-wrap items-center gap-2">
        {exchange.type !== 'fanout' && exchange.type !== 'headers' && (
          <>
            <span className="text-xs text-muted-foreground">{t('bindings.routingKey')}</span>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={running} className="h-7 w-56 text-xs font-mono" placeholder={exchange.type === 'topic' ? '#' : ''} />
          </>
        )}
        {!running ? (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={start}><Play className="h-3.5 w-3.5" /> {t('tail.start')}</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={stop}><Square className="h-3.5 w-3.5" /> {t('tail.stop')}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setPaused((p) => !p)}>{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} {paused ? t('tail.resume') : t('tail.pause')}</Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setMsgs([]); setTotal(0); }}><Eraser className="h-3.5 w-3.5" /> {t('tail.clear')}</Button>
        {running && <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><Radio className="h-3 w-3 animate-pulse" /> {t('tail.live')}</span>}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{t('tail.received', { count: total })}{total > TAIL_CAP ? ` · ${t('tail.keeping', { count: TAIL_CAP })}` : ''}</span>
      </div>
      {exchange.type === 'headers' && (
        <Textarea value={args} onChange={(e) => setArgs(e.target.value)} disabled={running} className="font-mono text-xs min-h-[48px] max-w-xl" />
      )}
      {error && <ErrorBanner message={error} />}
      <MessageList messages={msgs} fileName={`${exchange.name}-tail`} emptyText={running ? t('tail.waiting') : t('tail.idle')} />
    </div>
  );
}
