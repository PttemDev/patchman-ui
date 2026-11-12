import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rabbitAPI, type DBScope } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import type { RabbitConnection, RabbitExchange, RabbitPage } from '@/types';
import { ErrorBanner, Loading, TypeBadge } from './RabbitUI';
import { CreateExchangeDialog } from './RabbitDialogs';
import { fmtRate, openRabbitExchange, rateOf } from './rabbitUtil';

export function ExchangesSection({ conn, scope, vhost, vhosts, writable, tick }: {
  conn: RabbitConnection; scope: DBScope; vhost: string; vhosts: string[]; writable: boolean; tick: number;
}) {
  const { t } = useTranslation('rabbit');
  const [data, setData] = useState<RabbitPage<RabbitExchange> | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await rabbitAPI.exchanges(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope);
      setData(res.data as RabbitPage<RabbitExchange>);
      setError('');
    } catch (e) {
      setError(rabbitError(e).message);
    }
  }, [conn.id, scope, vhost]);
  useEffect(() => { void load(); }, [load, tick]);

  const q = filter.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((e) => {
    const system = !e.name || e.name.startsWith('amq.');
    if (system && !showSystem) return false;
    return !q || e.name.toLowerCase().includes(q);
  });

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('exchanges.filter')} className="h-7 text-xs pl-7" />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> {t('exchanges.showSystem')}
        </label>
        {writable && (
          <Button size="sm" className="ml-auto h-7 text-xs gap-1" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> {t('dialogs.newExchange')}</Button>
        )}
      </div>
      {error && !data ? <ErrorBanner message={error} onRetry={load} /> : !data ? <Loading /> : (
        <div className="rounded-md border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left bg-muted/30">
              <tr>
                <th className="font-medium pl-3 pr-2 py-1.5">{t('exchanges.name')}</th>
                {!vhost && <th className="font-medium px-2 py-1.5">{t('vhost.name')}</th>}
                <th className="font-medium px-2 py-1.5">{t('exchanges.flags')}</th>
                <th className="font-medium px-2 py-1.5 text-right">{t('queues.in')}</th>
                <th className="font-medium pl-2 pr-3 py-1.5 text-right">{t('queues.out')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('exchanges.empty')}</td></tr>}
              {rows.map((e) => (
                <tr key={`${e.vhost}|${e.name}`} className="border-t border-border/50 hover:bg-accent/30 cursor-pointer" onClick={() => openRabbitExchange(conn.id, e.vhost, e.name)}>
                  <td className="pl-3 pr-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <TypeBadge type={e.type} />
                      <span className="font-mono">{e.name || t('exchange.default')}</span>
                    </div>
                  </td>
                  {!vhost && <td className="px-2 py-1.5 font-mono text-muted-foreground">{e.vhost}</td>}
                  <td className="px-2 py-1.5 text-muted-foreground text-[11px]">
                    {[e.durable && t('dialogs.durable'), e.auto_delete && t('dialogs.autoDelete'), e.internal && t('dialogs.internal'), e.arguments?.['alternate-exchange'] != null && `AE: ${String(e.arguments['alternate-exchange'])}`].filter(Boolean).join(' · ')}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtRate(rateOf(e.message_stats, 'publish_in_details'))}</td>
                  <td className="pl-2 pr-3 py-1.5 text-right tabular-nums">{fmtRate(rateOf(e.message_stats, 'publish_out_details'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateExchangeDialog
        open={creating}
        onOpenChange={setCreating}
        conn={conn}
        scope={scope}
        vhosts={vhosts.length ? vhosts : ['/']}
        defaultVhost={vhost || '/'}
        onCreated={(vh, n) => { void load(); openRabbitExchange(conn.id, vh, n); }}
      />
    </div>
  );
}
