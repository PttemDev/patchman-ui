import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RefreshCw, Loader2, AlertTriangle, Search, Play, SlidersHorizontal, Plus } from 'lucide-react';
import { kafkaAPI, type DBScope } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useKafkaConnectionStore } from '@/stores/kafkaConnectionStore';
import { TopicConfigDialog } from './TopicConfigDialog';
import { TopicCreateWizard } from './TopicCreateWizard';
import type { KafkaTopicOverview, KafkaTopicDetail } from '@/types';
import { formatBytes } from '@/components/dbquery/formatters';

interface KafkaTopicsPanelProps {
  connId: string | undefined;
  scope: DBScope;
  /** Whether this tab is the visible/active one — gates the initial fetch. */
  active: boolean;
  onSelectTopic?: (topic: string) => void;
  selectedTopic?: string;
}

// Config keys surfaced first in the expanded topic detail, in this order.
const HIGHLIGHT_KEYS = [
  'cleanup.policy',
  'retention.ms',
  'retention.bytes',
  'max.message.bytes',
  'min.insync.replicas',
  'compression.type',
  'segment.ms',
  'segment.bytes',
];
// Config keys whose numeric-ms value we also render as a humanized duration.
const MS_KEYS = new Set(['retention.ms', 'segment.ms', 'min.compaction.lag.ms']);

// KafkaTopicsPanel is the Topics tab body of the Kafka bottom pane: an
// enriched topic overview (partitions / RF / approx message count / health)
// with a per-topic expand into partition + config detail. Fetching is gated
// on `active` and only runs once per (connId, scope) — no polling.
export function KafkaTopicsPanel({ connId, scope, active, onSelectTopic, selectedTopic }: KafkaTopicsPanelProps) {
  const { t } = useTranslation('kafka');
  const connections = useKafkaConnectionStore((s) => s.connections);
  const conn = useMemo(() => connections.find((c) => c.id === connId) ?? null, [connections, connId]);
  const writable = !!conn && conn.grantRole !== 'read';

  const [overview, setOverview] = useState<KafkaTopicOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState('');
  const [hideInternal, setHideInternal] = useState<boolean>(() => {
    try { return localStorage.getItem('patchman_kafka_topics_hide_internal') !== '0'; } catch { return true; }
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<KafkaTopicDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Detail-fetch error is kept separate from the overview `error` so a single
  // topic that fails to describe doesn't blank out the whole topic list.
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showAllCfg, setShowAllCfg] = useState(false);
  // Topic-admin dialogs (reuse the sidebar's): edit config for one topic,
  // create a new topic.
  const [configTopic, setConfigTopic] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Load-once guard, keyed by connection AND scope — flipping Local/Remote is
  // a different broker, so a connId-only key would leave a stale list.
  const loadedKeyRef = useRef('');

  useEffect(() => {
    try { localStorage.setItem('patchman_kafka_topics_hide_internal', hideInternal ? '1' : '0'); } catch { /* ignore */ }
  }, [hideInternal]);

  const load = useCallback(async () => {
    if (!connId) return;
    loadedKeyRef.current = `${connId}::${scope}`;
    setError(null);
    setLoading(true);
    try {
      const res = await kafkaAPI.topicsOverview(connId, scope);
      setOverview((res.data as KafkaTopicOverview[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('topics.loadTopicsFailed'));
    } finally {
      setLoading(false);
    }
  }, [connId, scope, t]);

  // Reset when the connection / scope changes — clear the previous cluster's
  // rows so "Loading…" shows instead of a stale list, and drop any expand.
  useEffect(() => {
    setExpanded(null);
    setDetail(null);
    setDetailError(null);
    setShowAllCfg(false);
    setOverview([]);
    loadedKeyRef.current = '';
  }, [connId, scope]);

  // Load once when first activated for this (connId, scope).
  useEffect(() => {
    if (!active || !connId) return;
    if (loadedKeyRef.current === `${connId}::${scope}`) return;
    load();
  }, [active, connId, scope, load]);

  const toggleTopic = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpanded(name);
    setDetail(null);
    setDetailError(null);
    setShowAllCfg(false);
    if (!connId) return;
    setDetailLoading(true);
    try {
      const res = await kafkaAPI.topicDetail(connId, name, scope);
      setDetail(res.data as KafkaTopicDetail);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : t('topics.loadDetailFailed'));
    } finally {
      setDetailLoading(false);
    }
  };

  // Filter at render — never mutate `overview` (a Refresh replaces it).
  const q = topicFilter.trim().toLowerCase();
  const shown = overview.filter(
    (t) => (!hideInternal || !t.internal) && (!q || t.name.toLowerCase().includes(q)),
  );
  // Topic | Part | RF | ≈Messages | Size | Health | Actions
  const colCount = 7;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controls row */}
      <div className="flex items-center gap-1.5 px-2 h-8 shrink-0 border-b bg-muted/30">
        {overview.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {t(overview.length === 1 ? 'topics.topicCountOne' : 'topics.topicCountOther', { count: overview.length })}
          </span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-1.5">
          {(overview.length > 8 || topicFilter) && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder={t('topics.filterTopics')}
                className="h-6 w-[150px] pl-6 pr-2 text-[11px]"
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setHideInternal((v) => !v)}
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
              hideInternal ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-accent',
            )}
            title={t('topics.hideInternalTitle')}
          >
            {t('topics.hideInternal')}
          </button>
          {writable && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => setCreateOpen(true)}
              disabled={!connId}
              title={t('topics.createTopicTitle')}
            >
              <Plus className="h-3 w-3" /> {t('topics.newTopic')}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={load} disabled={loading || !connId} title={t('common:refresh')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!connId ? (
          <div className="p-4 text-xs text-muted-foreground">{t('topics.selectConnection')}</div>
        ) : error ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        ) : overview.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {loading ? t('common:loading') : t('topics.noTopics')}
          </div>
        ) : (
          <TooltipProvider delayDuration={200}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-20 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground shadow-[0_1px_0_0_var(--color-border)]">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">{t('topics.colTopic')}</th>
                  <th className="text-right px-2 py-1.5 font-medium">{t('topics.colPart')}</th>
                  <th className="text-right px-2 py-1.5 font-medium">{t('topics.colRf')}</th>
                  <th className="text-right px-2 py-1.5 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dotted border-muted-foreground/50">{t('topics.colMessages')}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs max-w-[240px] normal-case tracking-normal">
                          {t('topics.messagesTooltip')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="text-right px-2 py-1.5 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dotted border-muted-foreground/50">{t('topics.colSize')}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs max-w-[260px] normal-case tracking-normal">{t('topics.sizeTooltip')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('topics.colHealth')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-3 py-3 text-xs text-muted-foreground">{t('topics.noMatchingTopics')}</td>
                  </tr>
                ) : (
                  shown.map((t) => (
                    <TopicRow
                      key={t.name}
                      topic={t}
                      selected={selectedTopic === t.name}
                      expanded={expanded === t.name}
                      detail={expanded === t.name ? detail : null}
                      detailLoading={expanded === t.name && detailLoading}
                      detailError={expanded === t.name ? detailError : null}
                      showAllCfg={showAllCfg}
                      onToggleShowAllCfg={() => setShowAllCfg((v) => !v)}
                      colCount={colCount}
                      onToggle={() => toggleTopic(t.name)}
                      onSelectTopic={onSelectTopic}
                      onEditConfig={() => setConfigTopic(t.name)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </TooltipProvider>
        )}
      </div>

      {/* Topic-admin dialogs — reuse the sidebar's. Config viewing works for
          read-only connections too; the BE gates the actual write. */}
      {conn && configTopic && (
        <TopicConfigDialog
          open={!!configTopic}
          onOpenChange={(o) => { if (!o) setConfigTopic(null); }}
          connection={conn}
          topic={configTopic}
        />
      )}
      {conn && (
        <TopicCreateWizard
          open={createOpen}
          onOpenChange={setCreateOpen}
          connection={conn}
          onCreated={() => load()}
        />
      )}
    </div>
  );
}

function TopicRow({
  topic,
  selected,
  expanded,
  detail,
  detailLoading,
  detailError,
  showAllCfg,
  onToggleShowAllCfg,
  colCount,
  onToggle,
  onSelectTopic,
  onEditConfig,
}: {
  topic: KafkaTopicOverview;
  selected: boolean;
  expanded: boolean;
  detail: KafkaTopicDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  showAllCfg: boolean;
  onToggleShowAllCfg: () => void;
  colCount: number;
  onToggle: () => void;
  onSelectTopic?: (topic: string) => void;
  onEditConfig: () => void;
}) {
  const { t } = useTranslation('kafka');
  return (
    <>
      <tr
        className={cn('border-t hover:bg-muted/20 cursor-pointer', selected && 'bg-primary/5')}
        onClick={onToggle}
      >
        <td className="px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 font-mono min-w-0">
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className="break-all">{topic.name}</span>
            {topic.internal && (
              <Badge variant="secondary" className="shrink-0 text-[9px] font-sans">{t('topics.internal')}</Badge>
            )}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{topic.partitions}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{topic.replicationFactor}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {topic.messageCount < 0 ? '—' : topic.messageCount.toLocaleString()}
        </td>
        <td
          className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
          title={sizeOk(topic.replicaSizeBytes) ? t('topics.sizeWithReplicas', { size: formatBytes(topic.replicaSizeBytes!) }) : undefined}
        >
          {sizeOk(topic.sizeBytes) ? formatBytes(topic.sizeBytes!) : '—'}
        </td>
        <td className="px-2 py-1.5">
          {topic.offline ? (
            <Badge variant="destructive" className="text-[10px]">{t('topics.healthOffline')}</Badge>
          ) : topic.underReplicated ? (
            <Badge variant="warning" className="text-[10px]">{t('topics.healthUnderReplicated')}</Badge>
          ) : (
            <Badge variant="success" className="text-[10px]">{t('topics.healthOk')}</Badge>
          )}
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center justify-end gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              title={t('topics.editConfigTitle')}
              onClick={(e) => { e.stopPropagation(); onEditConfig(); }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
            {onSelectTopic && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                title={t('topics.loadIntoPeek')}
                onClick={(e) => { e.stopPropagation(); onSelectTopic(topic.name); }}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/10">
          <td colSpan={colCount} className="px-3 py-2">
            {detailLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('topics.loadingDetail')}
              </div>
            ) : detailError ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{detailError}</span>
              </div>
            ) : detail ? (
              <TopicDetailBody detail={detail} showAllCfg={showAllCfg} onToggleShowAllCfg={onToggleShowAllCfg} />
            ) : (
              <div className="text-[11px] text-muted-foreground">{t('topics.noDetail')}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function TopicDetailBody({
  detail,
  showAllCfg,
  onToggleShowAllCfg,
}: {
  detail: KafkaTopicDetail;
  showAllCfg: boolean;
  onToggleShowAllCfg: () => void;
}) {
  const { t } = useTranslation('kafka');
  const highlighted = HIGHLIGHT_KEYS
    .map((k) => detail.config.find((c) => c.key === k))
    .filter((c): c is NonNullable<typeof c> => !!c);
  const rest = detail.config
    .filter((c) => !HIGHLIGHT_KEYS.includes(c.key))
    .sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div className="space-y-2">
      <TopicSummary detail={detail} />

      {/* Partition detail */}
      {detail.partitionDetail.length > 0 ? (
        <div className="rounded border overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-right px-2 py-1 font-medium">{t('lag.colPart')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('topics.colLeader')}</th>
                <th className="text-left px-2 py-1 font-medium">{t('topics.colReplicas')}</th>
                <th className="text-left px-2 py-1 font-medium">ISR</th>
                <th className="text-right px-2 py-1 font-medium">{t('topics.colLow')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('topics.colHigh')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('topics.colCount')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('topics.colSize')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.partitionDetail.map((pd) => {
                const replicas = pd.replicas ?? [];
                const isr = pd.isr ?? [];
                const isrShort = isr.length < replicas.length;
                return (
                  <Fragment key={pd.partition}>
                    <tr className="border-t">
                      <td className="px-2 py-1 text-right tabular-nums">{pd.partition}</td>
                      <td className={cn('px-2 py-1 text-right tabular-nums', pd.leader < 0 && 'text-amber-600 dark:text-amber-400')}>
                        {pd.leader < 0 ? t('topics.leaderNone') : pd.leader}
                      </td>
                      <td className="px-2 py-1 font-mono">{replicas.join(', ') || '—'}</td>
                      <td className={cn('px-2 py-1 font-mono', isrShort && 'text-amber-600 dark:text-amber-400')}>
                        {isr.join(', ') || '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{pd.low < 0 ? '—' : pd.low.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{pd.high < 0 ? '—' : pd.high.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{pd.count < 0 ? '—' : pd.count.toLocaleString()}</td>
                      <td
                        className="px-2 py-1 text-right tabular-nums whitespace-nowrap"
                        title={sizeOk(pd.replicaSizeBytes) ? t('topics.sizeWithReplicas', { size: formatBytes(pd.replicaSizeBytes!) }) : undefined}
                      >
                        {sizeOk(pd.sizeBytes) ? formatBytes(pd.sizeBytes!) : '—'}
                      </td>
                    </tr>
                    {pd.err && (
                      <tr>
                        <td colSpan={8} className="px-2 pb-1 text-amber-600 dark:text-amber-400 break-words">{pd.err}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">{t('topics.noPartitionDetail')}</div>
      )}

      {/* Config */}
      {detail.config.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('topics.config')}</div>
          <div className="space-y-0.5">
            {highlighted.map((c) => (
              <ConfigRow key={c.key} cfgKey={c.key} value={c.value} />
            ))}
          </div>
          {rest.length > 0 && (
            <>
              <button
                type="button"
                onClick={onToggleShowAllCfg}
                className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted"
              >
                {showAllCfg
                  ? t(rest.length === 1 ? 'topics.configHideOne' : 'topics.configHideOther', { count: rest.length })
                  : t(rest.length === 1 ? 'topics.configShowAllOne' : 'topics.configShowAllOther', { count: rest.length })}
              </button>
              {showAllCfg && (
                <div className="space-y-0.5 pt-0.5">
                  {rest.map((c) => (
                    <ConfigRow key={c.key} cfgKey={c.key} value={c.value} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Sizes are optional on the wire (older BE) and -1 when the broker wouldn't
// describe log dirs — either way the cell shows "—".
function sizeOk(n: number | undefined): boolean {
  return typeof n === 'number' && n >= 0;
}

// TopicSummary — the at-a-glance strip on top of a topic's detail: layout,
// volume, replication health and retention, before the per-partition table.
function TopicSummary({ detail }: { detail: KafkaTopicDetail }) {
  const { t } = useTranslation('kafka');
  const parts = detail.partitionDetail;
  const offline = parts.filter((p) => p.leader < 0 || !!p.err).length;
  const underRep = parts.filter((p) => !p.err && (p.isr ?? []).length < (p.replicas ?? []).length).length;
  const inSync = parts.length - underRep - offline;
  const cfg = (k: string) => detail.config.find((c) => c.key === k)?.value;
  const retMs = cfg('retention.ms');
  const retBytes = cfg('retention.bytes');
  const retention = [
    retMs != null && /^-?\d+$/.test(retMs.trim()) ? humanizeMs(parseInt(retMs, 10), t) : null,
    retBytes != null && /^-?\d+$/.test(retBytes.trim()) && parseInt(retBytes, 10) >= 0 ? formatBytes(parseInt(retBytes, 10)) : null,
  ].filter(Boolean).join(' · ');

  const tiles: Array<{ label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }> = [
    { label: t('topics.summary.partitions'), value: String(detail.partitions) },
    { label: t('topics.summary.replicationFactor'), value: String(detail.replicationFactor) },
    { label: t('topics.summary.messages'), value: detail.messageCount < 0 ? '—' : `≈ ${detail.messageCount.toLocaleString()}` },
    {
      label: t('topics.summary.size'),
      value: sizeOk(detail.sizeBytes) ? formatBytes(detail.sizeBytes!) : '—',
      sub: sizeOk(detail.replicaSizeBytes) ? t('topics.sizeWithReplicas', { size: formatBytes(detail.replicaSizeBytes!) }) : undefined,
    },
    {
      label: t('topics.summary.inSync'),
      value: `${inSync} / ${parts.length}`,
      sub: underRep > 0 ? t('topics.summary.underReplicated', { count: underRep }) : undefined,
      tone: underRep > 0 ? 'warn' : undefined,
    },
    { label: t('topics.summary.offline'), value: String(offline), tone: offline > 0 ? 'bad' : undefined },
    { label: t('topics.summary.retention'), value: retention || '—' },
    { label: t('topics.summary.cleanupPolicy'), value: cfg('cleanup.policy') ?? '—' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded border bg-background/60 px-2.5 py-1.5 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{tile.label}</div>
          <div
            className={cn(
              'text-sm font-medium tabular-nums truncate',
              tile.tone === 'warn' && 'text-amber-600 dark:text-amber-400',
              tile.tone === 'bad' && 'text-destructive',
            )}
            title={tile.value}
          >
            {tile.value}
          </div>
          {tile.sub && <div className="text-[10px] text-muted-foreground truncate" title={tile.sub}>{tile.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function ConfigRow({ cfgKey, value }: { cfgKey: string; value: string }) {
  const { t } = useTranslation('kafka');
  const human = MS_KEYS.has(cfgKey) && /^-?\d+$/.test(value.trim()) ? humanizeMs(parseInt(value, 10), t) : null;
  return (
    <div className="text-[11px] font-mono break-all">
      <span className="text-muted-foreground">{cfgKey}</span>
      <span className="text-muted-foreground"> = </span>
      <span className="text-foreground">{value}</span>
      {human && <span className="text-muted-foreground">  ({human})</span>}
    </div>
  );
}

// humanizeMs renders a millisecond duration as a compact d/h/m/s string.
// -1 (and any negative) means "unlimited" in Kafka's retention semantics.
function humanizeMs(ms: number, t: (key: string) => string): string {
  if (ms < 0) return t('topics.unlimited');
  if (ms === 0) return '0s';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}
