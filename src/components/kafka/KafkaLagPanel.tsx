import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RefreshCw, Loader2, AlertTriangle, Users, Search } from 'lucide-react';
import { kafkaAPI, type DBScope } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { KafkaGroupLagSummary, KafkaGroupLagDetail } from '@/types';

interface KafkaLagPanelProps {
  connId: string | undefined;
  scope: DBScope;
  topic?: string;
  /** Whether this tab is the visible/active one — gates fetch + polling. */
  active: boolean;
  /** Auto-refresh interval, owned by the parent so it persists per-tab. */
  interval: Interval;
  onIntervalChange: (i: Interval) => void;
}

export type Interval = 'off' | '2' | '5' | '10';

function stateBadgeVariant(state: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (state) {
    case 'Stable':
      return 'success';
    case 'Empty':
      return 'secondary';
    case 'Dead':
      return 'destructive';
    default:
      return 'warning'; // PreparingRebalance / CompletingRebalance / Unknown
  }
}

// KafkaLagPanel is the Consumer Lag tab body of the Kafka bottom pane:
// consumer groups with total lag, expandable to per-member / per-partition
// detail. Refresh is client-side polling, gated on `active` (the parent
// owns collapse/tab visibility) and paused while the tab/window is hidden.
export function KafkaLagPanel({ connId, scope, topic, active, interval, onIntervalChange }: KafkaLagPanelProps) {
  const { t } = useTranslation('kafka');
  const [summaries, setSummaries] = useState<KafkaGroupLagSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicOnly, setTopicOnly] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<KafkaGroupLagDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const expandedRef = useRef<string | null>(null);
  expandedRef.current = expanded;

  const load = useCallback(async () => {
    if (!connId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await kafkaAPI.lag(connId, topicOnly && topic ? topic : undefined, scope);
      setSummaries((res.data as KafkaGroupLagSummary[]) ?? []);
      const g = expandedRef.current;
      if (g) {
        const d = await kafkaAPI.groupLag(connId, g, scope);
        setDetail(d.data as KafkaGroupLagDetail);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lag.loadLagFailed'));
    } finally {
      setLoading(false);
    }
  }, [connId, scope, topic, topicOnly, t]);

  // Fetch on activation + poll on the selected interval, pausing while the
  // tab is inactive (collapsed / other tab shown) or the tab/window is hidden
  // (no point hammering the broker off-screen).
  useEffect(() => {
    if (!active || !connId) return;
    load();
    if (interval === 'off') return;
    const ms = Number(interval) * 1000;
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, ms);
    return () => window.clearInterval(id);
  }, [active, connId, interval, load]);

  const toggleGroup = async (group: string) => {
    if (expanded === group) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(group);
    setDetail(null);
    if (!connId) return;
    setDetailLoading(true);
    try {
      const d = await kafkaAPI.groupLag(connId, group, scope);
      setDetail(d.data as KafkaGroupLagDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lag.loadDetailFailed'));
    } finally {
      setDetailLoading(false);
    }
  };

  // Filter groups at render (never mutate `summaries` — the poll replaces it).
  const q = groupFilter.trim().toLowerCase();
  const shown = q ? summaries.filter((s) => s.group.toLowerCase().includes(q)) : summaries;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controls row (the tab bar owns the collapse chevron + label). */}
      <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-b bg-muted/30">
        {summaries.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {t(summaries.length === 1 ? 'lag.groupCountOne' : 'lag.groupCountOther', { count: summaries.length })}
          </span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-1.5">
          {(summaries.length > 8 || groupFilter) && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                placeholder={t('lag.filterGroups')}
                className="h-6 w-[150px] pl-6 pr-2 text-[11px]"
              />
            </div>
          )}
          {topic && (
            <button
              type="button"
              onClick={() => setTopicOnly((v) => !v)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                topicOnly ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-accent',
              )}
              title={t('lag.topicOnlyTitle')}
            >
              {t('lag.topicOnly')}
            </button>
          )}
          <Select value={interval} onValueChange={(v) => onIntervalChange(v as Interval)}>
            <SelectTrigger className="h-6 w-[92px] text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off" className="text-xs">{t('lag.intervalManual')}</SelectItem>
              <SelectItem value="2" className="text-xs">{t('lag.intervalEvery', { n: 2 })}</SelectItem>
              <SelectItem value="5" className="text-xs">{t('lag.intervalEvery', { n: 5 })}</SelectItem>
              <SelectItem value="10" className="text-xs">{t('lag.intervalEvery', { n: 10 })}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={load} disabled={loading || !connId} title={t('common:refresh')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body — always rendered; the parent controls visibility via `hidden`. */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!connId ? (
          <div className="p-4 text-xs text-muted-foreground">{t('lag.selectConnection')}</div>
        ) : error ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        ) : summaries.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {loading ? t('common:loading') : t('lag.noConsumerGroups')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-20 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground shadow-[0_1px_0_0_var(--color-border)]">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">{t('lag.colGroup')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('lag.colState')}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t('lag.colMembers')}</th>
                <th className="text-right px-3 py-1.5 font-medium">{t('lag.colTotalLag')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">{t('lag.noMatchingGroups')}</td>
                </tr>
              ) : (
                shown.map((s) => (
                  <GroupRow
                    key={s.group}
                    summary={s}
                    expanded={expanded === s.group}
                    detail={expanded === s.group ? detail : null}
                    detailLoading={expanded === s.group && detailLoading}
                    onToggle={() => toggleGroup(s.group)}
                  />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function lagClass(lag: number): string {
  if (lag < 0) return 'text-muted-foreground';
  if (lag === 0) return 'text-emerald-600 dark:text-emerald-400';
  if (lag > 10000) return 'text-red-600 dark:text-red-400 font-semibold';
  return 'text-amber-600 dark:text-amber-400';
}

function GroupRow({
  summary,
  expanded,
  detail,
  detailLoading,
  onToggle,
}: {
  summary: KafkaGroupLagSummary;
  expanded: boolean;
  detail: KafkaGroupLagDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('kafka');
  return (
    <>
      <tr className="border-t hover:bg-muted/20 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 font-mono">
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className="break-all">{summary.group}</span>
          </span>
        </td>
        <td className="px-2 py-1.5">
          <Badge variant={stateBadgeVariant(summary.state)} className="text-[10px]">{summary.state || '—'}</Badge>
          {summary.error && <AlertTriangle className="inline h-3 w-3 ml-1 text-amber-500" aria-label={summary.error} />}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{summary.members}</td>
        <td className={cn('px-3 py-1.5 text-right tabular-nums', lagClass(summary.totalLag))}>
          {summary.totalLag < 0 ? '—' : summary.totalLag.toLocaleString()}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/10">
          <td colSpan={4} className="px-3 py-2">
            {detailLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('lag.loadingDetail')}
              </div>
            ) : detail ? (
              <div className="space-y-2">
                {summary.error && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 break-words">{summary.error}</div>
                )}
                {/* Members */}
                {detail.members.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Users className="h-3 w-3" /> {t('lag.membersHeading', { count: detail.memberCount })}
                    </div>
                    {detail.members.map((m) => (
                      <div key={m.memberId} className="text-[11px] font-mono pl-4 break-all">
                        <span className="text-foreground">{m.clientId || m.memberId}</span>
                        <span className="text-muted-foreground"> @ {m.clientHost || '?'}</span>
                        <span className="text-muted-foreground">
                          {' · '}
                          {m.assigned.map((a) => `${a.topic}[${a.partitions.join(',')}]`).join(' ') || t('lag.noAssignment')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Partition lag */}
                {detail.partitions.length > 0 ? (
                  <div className="rounded border overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-1 font-medium">{t('lag.colTopic')}</th>
                          <th className="text-right px-2 py-1 font-medium">{t('lag.colPart')}</th>
                          <th className="text-right px-2 py-1 font-medium">{t('lag.colCommitted')}</th>
                          <th className="text-right px-2 py-1 font-medium">{t('lag.colEnd')}</th>
                          <th className="text-right px-2 py-1 font-medium">{t('lag.colLag')}</th>
                          <th className="text-left px-2 py-1 font-medium">{t('lag.colConsumer')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.partitions.map((p) => (
                          <tr key={`${p.topic}/${p.partition}`} className="border-t">
                            <td className="px-2 py-1 font-mono break-all">{p.topic}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.partition}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.committed < 0 ? '—' : p.committed.toLocaleString()}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{p.end < 0 ? '—' : p.end.toLocaleString()}</td>
                            <td className={cn('px-2 py-1 text-right tabular-nums', lagClass(p.lag))}>
                              {p.err ? '⚠' : p.lag < 0 ? '—' : p.lag.toLocaleString()}
                            </td>
                            <td className="px-2 py-1 font-mono text-muted-foreground break-all">{p.clientId || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">{t('lag.noCommittedOffsets')}</div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">{t('lag.noDetail')}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
