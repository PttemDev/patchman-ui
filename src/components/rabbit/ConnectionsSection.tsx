import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Search, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { rabbitAPI, type DBScope } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import { cn } from '@/lib/utils';
import type { RabbitConnection, RabbitPage } from '@/types';
import { ErrorBanner, Loading } from './RabbitUI';
import { ConfirmDialog } from './RabbitDialogs';
import { fmtBytes, fmtDuration, fmtNum, openRabbitQueue } from './rabbitUtil';

interface ClientConn {
  name: string; user?: string; vhost?: string; peer_host?: string; peer_port?: number; protocol?: string; ssl?: boolean;
  state?: string; channels?: number; connected_at?: number;
  client_properties?: { connection_name?: string; product?: string; version?: string; platform?: string };
  recv_oct_details?: { rate?: number }; send_oct_details?: { rate?: number };
}
interface Channel {
  name: string; user?: string; vhost?: string; number?: number; state?: string; consumer_count?: number;
  messages_unacknowledged?: number; prefetch_count?: number; global_prefetch_count?: number; confirm?: boolean; transactional?: boolean;
  connection_details?: { name?: string; peer_host?: string };
}
interface Consumer {
  consumer_tag: string; queue: { name: string; vhost: string }; ack_required?: boolean; prefetch_count?: number; active?: boolean;
  activity_status?: string; channel_details?: { name?: string; connection_name?: string; user?: string };
}

type View = 'connections' | 'channels' | 'consumers';

export function ConnectionsSection({ conn, scope, writable, tick }: { conn: RabbitConnection; scope: DBScope; writable: boolean; tick: number }) {
  const { t } = useTranslation('rabbit');
  const [view, setView] = useState<View>('connections');
  const [conns, setConns] = useState<ClientConn[] | null>(null);
  const [chans, setChans] = useState<Channel[] | null>(null);
  const [cons, setCons] = useState<Consumer[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [closing, setClosing] = useState<ClientConn | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      if (view === 'connections') {
        const res = await rabbitAPI.connections(conn.id, { pageSize: 500, sort: 'name' }, scope);
        setConns((res.data as RabbitPage<ClientConn>).items ?? []);
      } else if (view === 'channels') {
        const res = await rabbitAPI.channels(conn.id, { pageSize: 500, sort: 'name' }, scope);
        setChans((res.data as RabbitPage<Channel>).items ?? []);
      } else {
        const res = await rabbitAPI.consumers(conn.id, '', scope);
        setCons((res.data as Consumer[]) ?? []);
      }
      setError('');
    } catch (e) {
      setError(rabbitError(e).message);
    }
  }, [conn.id, scope, view]);
  useEffect(() => { void load(); }, [load, tick]);

  const q = filter.trim().toLowerCase();
  const match = (...vals: Array<string | undefined>) => !q || vals.some((v) => v?.toLowerCase().includes(q));
  const loaded = view === 'connections' ? conns : view === 'channels' ? chans : cons;

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(['connections', 'channels', 'consumers'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn('px-2.5 py-1 text-xs rounded', view === v ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>
              {t(`conn.${v}`)}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('conn.filter')} className="h-7 text-xs pl-7" />
        </div>
      </div>
      {error && !loaded ? <ErrorBanner message={error} onRetry={load} /> : !loaded ? <Loading /> : (
        <div className="rounded-md border bg-card overflow-x-auto">
          {view === 'connections' && conns && (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left bg-muted/30">
                <tr>
                  <th className="font-medium pl-3 pr-2 py-1.5">{t('conn.client')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.user')}</th>
                  <th className="font-medium px-2 py-1.5">{t('vhost.name')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.from')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.state')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('conn.channels')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('conn.recv')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('conn.send')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.since')}</th>
                  {writable && <th className="pr-3" />}
                </tr>
              </thead>
              <tbody>
                {conns.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('conn.empty')}</td></tr>}
                {conns.filter((c) => match(c.name, c.user, c.vhost, c.client_properties?.connection_name, c.client_properties?.product)).map((c) => (
                  <tr key={c.name} className="border-t border-border/50 hover:bg-accent/20">
                    <td className="pl-3 pr-2 py-1.5 min-w-[180px]">
                      <div className="font-medium truncate max-w-[280px]" title={c.name}>{c.client_properties?.connection_name || c.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[280px]">
                        {[c.client_properties?.product, c.client_properties?.version, c.client_properties?.platform].filter(Boolean).join(' · ')} · {c.protocol}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 font-mono">{c.user}</td>
                    <td className="px-2 py-1.5 font-mono">{c.vhost}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{c.ssl && <Lock className="h-3 w-3 inline mr-1 text-emerald-600" />}{c.peer_host}:{c.peer_port}</td>
                    <td className={cn('px-2 py-1.5', c.state !== 'running' && 'text-amber-600 dark:text-amber-400')}>{c.state}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(c.channels)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtBytes(c.recv_oct_details?.rate)}/s</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtBytes(c.send_oct_details?.rate)}/s</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{c.connected_at ? fmtDuration(Date.now() - c.connected_at) : '–'}</td>
                    {writable && (
                      <td className="pr-3 py-1.5 text-right">
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-destructive hover:text-destructive" onClick={() => { setReason(''); setClosing(c); }}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> {t('conn.close')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'channels' && chans && (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left bg-muted/30">
                <tr>
                  <th className="font-medium pl-3 pr-2 py-1.5">{t('conn.channel')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.user')}</th>
                  <th className="font-medium px-2 py-1.5">{t('vhost.name')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.mode')}</th>
                  <th className="font-medium px-2 py-1.5">{t('conn.state')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('queue.consumers')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('conn.prefetch')}</th>
                  <th className="font-medium pl-2 pr-3 py-1.5 text-right">{t('queue.unacked')}</th>
                </tr>
              </thead>
              <tbody>
                {chans.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('conn.empty')}</td></tr>}
                {chans.filter((c) => match(c.name, c.user, c.vhost)).map((c) => (
                  <tr key={c.name} className="border-t border-border/50">
                    <td className="pl-3 pr-2 py-1.5 font-mono truncate max-w-[320px]" title={c.name}>{c.name}</td>
                    <td className="px-2 py-1.5 font-mono">{c.user}</td>
                    <td className="px-2 py-1.5 font-mono">{c.vhost}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{[c.confirm && 'confirm', c.transactional && 'tx'].filter(Boolean).join(' · ') || '–'}</td>
                    <td className={cn('px-2 py-1.5', c.state !== 'running' && c.state !== 'idle' && 'text-amber-600 dark:text-amber-400')}>{c.state}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(c.consumer_count)}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', c.prefetch_count === 0 && (c.consumer_count ?? 0) > 0 && 'text-amber-600 dark:text-amber-400')} title={c.prefetch_count === 0 && (c.consumer_count ?? 0) > 0 ? t('conn.unlimitedPrefetch') : undefined}>
                      {c.prefetch_count === 0 ? '∞' : fmtNum(c.prefetch_count)}
                    </td>
                    <td className="pl-2 pr-3 py-1.5 text-right tabular-nums">{fmtNum(c.messages_unacknowledged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'consumers' && cons && (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left bg-muted/30">
                <tr>
                  <th className="font-medium pl-3 pr-2 py-1.5">{t('bindings.queue')}</th>
                  <th className="font-medium px-2 py-1.5">{t('consumers.tag')}</th>
                  <th className="font-medium px-2 py-1.5">{t('consumers.client')}</th>
                  <th className="font-medium px-2 py-1.5">{t('consumers.ack')}</th>
                  <th className="font-medium px-2 py-1.5 text-right">{t('conn.prefetch')}</th>
                  <th className="font-medium pl-2 pr-3 py-1.5">{t('consumers.status')}</th>
                </tr>
              </thead>
              <tbody>
                {cons.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('consumers.none')}</td></tr>}
                {cons.filter((c) => match(c.queue.name, c.consumer_tag, c.channel_details?.connection_name)).map((c) => (
                  <tr key={`${c.queue.vhost}|${c.queue.name}|${c.consumer_tag}|${c.channel_details?.name}`} className="border-t border-border/50">
                    <td className="pl-3 pr-2 py-1.5">
                      <button type="button" className="font-mono hover:underline" onClick={() => openRabbitQueue(conn.id, c.queue.vhost, c.queue.name)}>{c.queue.name}</button>
                      <span className="ml-1 text-[10px] text-muted-foreground font-mono">{c.queue.vhost}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono truncate max-w-[220px]" title={c.consumer_tag}>{c.consumer_tag}</td>
                    <td className="px-2 py-1.5 truncate max-w-[240px]" title={c.channel_details?.connection_name}>{c.channel_details?.connection_name}</td>
                    <td className="px-2 py-1.5">{c.ack_required ? t('consumers.manual') : t('consumers.auto')}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.prefetch_count === 0 ? '∞' : fmtNum(c.prefetch_count)}</td>
                    <td className="pl-2 pr-3 py-1.5">{c.activity_status ?? (c.active === false ? 'waiting' : 'up')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!closing}
        onOpenChange={(o) => { if (!o) setClosing(null); }}
        title={t('conn.closeTitle')}
        description={t('conn.closeDescription', { name: closing?.client_properties?.connection_name || closing?.name })}
        confirmText={t('conn.close')}
        danger
        onConfirm={async () => {
          if (!closing) return;
          await rabbitAPI.closeConnection(conn.id, closing.name, reason, scope);
          await load();
        }}
      >
        <div>
          <Label className="text-xs">{t('conn.reason')}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('conn.reasonPlaceholder')} className="text-xs" />
        </div>
      </ConfirmDialog>
    </div>
  );
}
