import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, ChevronLeft, ChevronRight, Regex, Skull, Clock, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rabbitAPI, type DBScope } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import { cn } from '@/lib/utils';
import type { RabbitConnection, RabbitPage, RabbitQueue } from '@/types';
import { ErrorBanner, Loading, SortTh, TypeBadge } from './RabbitUI';
import { CreateQueueDialog } from './RabbitDialogs';
import { fmtBytes, fmtNum, fmtRate, isDeadLetterQueue, openRabbitQueue, queueSetting, rateOf } from './rabbitUtil';

// Queues of a vhost (or all vhosts), paged / sorted / filtered by the
// management API itself so large brokers stay fast. Rows flag what needs
// attention: messages with no consumer, dead-letter queues holding messages.
export function QueuesSection({ conn, scope, vhost, vhosts, writable, tick }: {
  conn: RabbitConnection; scope: DBScope; vhost: string; vhosts: string[]; writable: boolean; tick: number;
}) {
  const { t } = useTranslation('rabbit');
  const [data, setData] = useState<RabbitPage<RabbitQueue> | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [debounced, setDebounced] = useState('');
  const [regex, setRegex] = useState(false);
  const [sort, setSort] = useState('name');
  const [reverse, setReverse] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setDebounced(name); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [name]);

  const load = useCallback(async () => {
    try {
      const res = await rabbitAPI.queues(conn.id, { vhost, page, pageSize: 100, name: debounced, regex, sort, reverse }, scope);
      setData(res.data as RabbitPage<RabbitQueue>);
      setError('');
    } catch (e) {
      setError(rabbitError(e).message);
    }
  }, [conn.id, scope, vhost, page, debounced, regex, sort, reverse]);

  useEffect(() => { void load(); }, [load, tick]);
  useEffect(() => { setPage(1); }, [vhost]);

  const onSort = (f: string) => {
    if (sort === f) setReverse((r) => !r);
    else { setSort(f); setReverse(f !== 'name'); }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('queues.filter')} className="h-7 text-xs pl-7 pr-8" />
          <button type="button" onClick={() => setRegex((r) => !r)} title={t('queues.regex')} className={cn('absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5', regex ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Regex className="h-3.5 w-3.5" />
          </button>
        </div>
        {data && <span className="text-[11px] text-muted-foreground">{t('queues.count', { count: data.filtered_count })}</span>}
        <div className="ml-auto flex items-center gap-1">
          {data && data.page_count > 1 && (
            <>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="text-[11px] text-muted-foreground tabular-nums px-1">{data.page} / {data.page_count}</span>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= data.page_count} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
            </>
          )}
          {writable && (
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> {t('dialogs.newQueue')}</Button>
          )}
        </div>
      </div>

      {error && !data ? <ErrorBanner message={error} onRetry={load} /> : !data ? <Loading /> : (
        <div className="rounded-md border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left bg-muted/30">
              <tr>
                <SortTh label={t('queues.name')} field="name" sort={sort} reverse={reverse} onSort={onSort} className="pl-3" />
                {!vhost && <th className="font-medium px-2 py-1.5">{t('vhost.name')}</th>}
                <th className="font-medium px-2 py-1.5">{t('queues.features')}</th>
                <SortTh label={t('queue.ready')} field="messages_ready" sort={sort} reverse={reverse} onSort={onSort} className="text-right" />
                <SortTh label={t('queue.unacked')} field="messages_unacknowledged" sort={sort} reverse={reverse} onSort={onSort} className="text-right" />
                <SortTh label={t('queue.total')} field="messages" sort={sort} reverse={reverse} onSort={onSort} className="text-right" />
                <SortTh label={t('queue.consumers')} field="consumers" sort={sort} reverse={reverse} onSort={onSort} className="text-right" />
                <SortTh label={t('queues.in')} field="message_stats.publish_details.rate" sort={sort} reverse={reverse} onSort={onSort} className="text-right" />
                <SortTh label={t('queues.out')} field="message_stats.deliver_get_details.rate" sort={sort} reverse={reverse} onSort={onSort} className="text-right" />
                <SortTh label={t('queues.memory')} field="memory" sort={sort} reverse={reverse} onSort={onSort} className="text-right pr-3" />
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('queues.empty')}</td></tr>
              )}
              {data.items.map((q) => {
                const msgs = q.messages ?? 0;
                const stuck = q.type !== 'stream' && msgs > 0 && (q.consumers ?? 0) === 0;
                const dlq = isDeadLetterQueue(q);
                const dlx = queueSetting(q, 'dead-letter-exchange');
                const ttl = queueSetting(q, 'message-ttl');
                const maxLen = queueSetting(q, 'max-length');
                return (
                  <tr key={`${q.vhost}|${q.name}`} className="border-t border-border/50 hover:bg-accent/30 cursor-pointer" onClick={() => openRabbitQueue(conn.id, q.vhost, q.name)}>
                    <td className="pl-3 pr-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TypeBadge type={q.type} />
                        <span className="font-mono truncate max-w-[360px]" title={q.name}>{q.name}</span>
                        {q.state && q.state !== 'running' && <span className="text-[10px] text-amber-600 dark:text-amber-400">{q.state}</span>}
                      </div>
                    </td>
                    {!vhost && <td className="px-2 py-1.5 font-mono text-muted-foreground">{q.vhost}</td>}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        {dlx != null && <span title={`${t('queue.dlx')}: ${String(dlx)}`}><Skull className="h-3 w-3" /></span>}
                        {ttl != null && <span title={`TTL ${String(ttl)} ms`}><Clock className="h-3 w-3" /></span>}
                        {maxLen != null && <span title={`${t('queue.maxLength')} ${String(maxLen)}`}><Layers className="h-3 w-3" /></span>}
                        {q.policy && <span className="text-[10px] rounded border px-1" title={t('queue.policy')}>{q.policy}</span>}
                      </div>
                    </td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', stuck && 'text-amber-600 dark:text-amber-400 font-medium', dlq && msgs > 0 && 'text-destructive font-medium')}>{fmtNum(q.messages_ready)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(q.messages_unacknowledged)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(q.messages)}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', stuck && 'text-amber-600 dark:text-amber-400')} title={stuck ? t('queues.noConsumer') : undefined}>{fmtNum(q.consumers)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtRate(rateOf(q.message_stats, 'publish_details'))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtRate(rateOf(q.message_stats, 'deliver_get_details'))}</td>
                    <td className="pl-2 pr-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtBytes(q.memory)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateQueueDialog
        open={creating}
        onOpenChange={setCreating}
        conn={conn}
        scope={scope}
        vhosts={vhosts.length ? vhosts : ['/']}
        defaultVhost={vhost || '/'}
        onCreated={(vh, n) => { void load(); openRabbitQueue(conn.id, vh, n); }}
      />
    </div>
  );
}
