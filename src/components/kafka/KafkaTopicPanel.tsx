import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Radio,
  Play,
  Loader2,
  Download,
  Send,
  AlertTriangle,
  FileJson,
  FileSpreadsheet,
  Plus,
  X,
  ShieldAlert,
  Copy,
  Search,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { kafkaAPI, type DBScope } from '@/services/api';

// Module-level topic-list cache keyed by connection+scope. The tab body unmounts
// when you switch away, so without this every return to a Kafka tab refetched
// the topic list from scratch. Cached topics render instantly and are refreshed
// in the background, so switching tabs no longer feels like a cold reload.
const kafkaTopicsCache = new Map<string, KafkaTopicSummary[]>();
import { useKafkaConnectionStore, scopeForKafka } from '@/stores/kafkaConnectionStore';
import { ExecScopePicker } from '@/components/common/ExecScopePicker';
import { useRequestStore } from '@/stores/requestStore';
import { DBJsonModal, canShowAsJson } from '@/components/dbquery/DBJsonModal';
import { KafkaBottomPanel, type BottomLayout } from './KafkaBottomPanel';
import { type Interval } from './KafkaLagPanel';
import type {
  Tab,
  KafkaConnection,
  KafkaConsumeResult,
  KafkaFetchMode,
  KafkaMessage,
  KafkaTopicSummary,
} from '@/types';

interface KafkaTopicPanelProps {
  tab: Tab;
}

type DecodeMode = 'auto' | 'json' | 'hex' | 'base64' | 'utf8';

type MsgField = 'partition' | 'offset' | 'timestamp' | 'key' | 'headers' | 'value';

// Message-grid columns. `def` is the default width (px); users can drag to
// resize and the width is remembered per column id for the tab's lifetime.
// `labelKey` is resolved with t() at render.
const MSG_COLUMNS: { id: MsgField; labelKey: string; def: number }[] = [
  { id: 'partition', labelKey: 'peek.colPartition', def: 70 },
  { id: 'offset', labelKey: 'peek.colOffset', def: 96 },
  { id: 'timestamp', labelKey: 'peek.colTimestamp', def: 200 },
  { id: 'key', labelKey: 'peek.colKey', def: 170 },
  { id: 'headers', labelKey: 'peek.colHeaders', def: 224 },
  { id: 'value', labelKey: 'peek.colValue', def: 520 },
];

// Fetch-mode → i18n key (resolved with t() at render).
const MODE_LABEL_KEYS: Record<KafkaFetchMode, string> = {
  first: 'peek.modeFirst',
  last: 'peek.modeLast',
  offset: 'peek.modeOffset',
  timestamp: 'peek.modeTimestamp',
};

// Cell-detail field → i18n key for the full field label.
const FIELD_LABEL_KEYS: Record<MsgField, string> = {
  partition: 'peek.fieldPartition',
  offset: 'peek.fieldOffset',
  timestamp: 'peek.fieldTimestamp',
  key: 'peek.fieldKey',
  headers: 'peek.fieldHeaders',
  value: 'peek.fieldValue',
};

function canWrite(conn: KafkaConnection | null): boolean {
  return !!conn && conn.grantRole !== 'read';
}

// KafkaTopicPanel is the Kafka tab body: connection + topic pickers, a
// read-only "peek" fetch bar, a message table, and a Publish dialog. It
// never commits offsets — the consume endpoint reads without a group.
export function KafkaTopicPanel({ tab }: KafkaTopicPanelProps) {
  const { t } = useTranslation('kafka');
  const connections = useKafkaConnectionStore((s) => s.connections);
  const fetchConnections = useKafkaConnectionStore((s) => s.fetchConnections);
  const updateTab = useRequestStore((s) => s.updateTab);
  const { toast } = useToast();

  const connId = tab.kafkaConnectionId;
  const topic = tab.kafkaTopic;
  const conn = useMemo(() => connections.find((c) => c.id === connId) ?? null, [connections, connId]);
  // Effective execution scope: per-tab override wins over the connection's
  // home scope. Determines which BE (local desktop / hosted) actually
  // connects to the broker — matters when a cluster is only reachable from
  // one side (localhost/LAN vs. behind the server network).
  const scope: DBScope = tab.kafkaExecScope
    ?? conn?.scope
    ?? (connId ? scopeForKafka(connections, connId) : 'remote');
  const writable = canWrite(conn);

  const [topics, setTopics] = useState<KafkaTopicSummary[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  // Topic-dropdown search (only surfaced when the list is long).
  const [topicQuery, setTopicQuery] = useState('');
  const topicSearchRef = useRef<HTMLInputElement>(null);

  // Consumer-lag bottom panel: collapsed by default, resizable split.
  const lagContainerRef = useRef<HTMLDivElement>(null);
  const [lagCollapsed, setLagCollapsed] = useState(() => {
    try { return localStorage.getItem('patchman_kafka_lag_collapsed') !== '0'; } catch { return true; }
  });
  const [lagRatio, setLagRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('patchman_kafka_lag_ratio') || '');
      return !isNaN(v) && v >= 15 && v <= 70 ? v : 40;
    } catch { return 40; }
  });
  useEffect(() => {
    try { localStorage.setItem('patchman_kafka_lag_collapsed', lagCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [lagCollapsed]);
  // Tabs vs stacked (Consumer Lag above Topics) — a per-user preference.
  const [bottomLayout, setBottomLayout] = useState<BottomLayout>(() => {
    try { return localStorage.getItem('patchman_kafka_bottom_layout') === 'stacked' ? 'stacked' : 'tabs'; } catch { return 'tabs'; }
  });
  useEffect(() => {
    try { localStorage.setItem('patchman_kafka_bottom_layout', bottomLayout); } catch { /* ignore */ }
  }, [bottomLayout]);
  // Two lists share the pane when stacked — give it room (still draggable).
  const changeBottomLayout = useCallback((next: BottomLayout) => {
    setBottomLayout(next);
    if (next === 'stacked') {
      setLagRatio((r) => {
        const grown = Math.max(r, 55);
        try { localStorage.setItem('patchman_kafka_lag_ratio', String(Math.round(grown))); } catch { /* ignore */ }
        return grown;
      });
    }
  }, []);
  const onLagSplitDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = lagContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = Math.min(Math.max(((rect.bottom - ev.clientY) / rect.height) * 100, 15), 70);
      setLagRatio(pct);
      try { localStorage.setItem('patchman_kafka_lag_ratio', String(Math.round(pct))); } catch { /* ignore */ }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  const [mode, setMode] = useState<KafkaFetchMode>((tab.kafkaFetchMode as KafkaFetchMode) ?? 'last');
  const [n, setN] = useState(tab.kafkaFetchN ?? 100);
  const [partition, setPartition] = useState(tab.kafkaFetchPartition ?? -1);
  const [offsetInput, setOffsetInput] = useState(tab.kafkaFetchOffset ?? '0');
  const [timestampInput, setTimestampInput] = useState(tab.kafkaFetchTimestamp ?? '');
  const [decode, setDecode] = useState<DecodeMode>((tab.kafkaDecode as DecodeMode) ?? 'auto');
  // Bottom-pane selection + consumer-lag refresh rate — owned here (not in
  // localStorage / a child's local state) so each Kafka tab keeps its own.
  const [bottomTab, setBottomTab] = useState<'lag' | 'topics'>(
    tab.kafkaBottomTab === 'topics' ? 'topics' : 'lag',
  );
  const [lagInterval, setLagInterval] = useState<Interval>((tab.kafkaLagInterval as Interval) ?? 'off');

  // Persist the fetch controls to the tab so they survive a tab switch — the
  // panel unmounts when you leave the tab, which would otherwise reset them.
  useEffect(() => {
    updateTab(tab.id, {
      kafkaFetchMode: mode,
      kafkaFetchN: n,
      kafkaFetchPartition: partition,
      kafkaFetchOffset: offsetInput,
      kafkaFetchTimestamp: timestampInput,
      kafkaDecode: decode,
      kafkaBottomTab: bottomTab,
      kafkaLagInterval: lagInterval,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, n, partition, offsetInput, timestampInput, decode, bottomTab, lagInterval]);

  const [result, setResult] = useState<KafkaConsumeResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [jsonModal, setJsonModal] = useState<{ value: unknown; label: string } | null>(null);
  // Cell-detail dialog for non-JSON cell content (key / value / part / …).
  const [rawCell, setRawCell] = useState<{ title: string; content: string } | null>(null);
  // Per-column widths (px) for the resizable message grid, keyed by col id.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  // Publish dialog.
  const [publishOpen, setPublishOpen] = useState(false);
  const [pubTopic, setPubTopic] = useState('');
  const [pubPartition, setPubPartition] = useState(-1);
  const [pubKey, setPubKey] = useState('');
  const [pubValue, setPubValue] = useState('');
  const [pubHeaders, setPubHeaders] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [publishing, setPublishing] = useState(false);
  const [pubError, setPubError] = useState('');

  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  const partitionCount = useMemo(
    () => topics.find((t) => t.name === topic)?.partitions ?? 0,
    [topics, topic],
  );
  const pubPartitionCount = useMemo(
    () => topics.find((t) => t.name === pubTopic)?.partitions ?? 0,
    [topics, pubTopic],
  );

  // Load the topic list whenever the connection changes.
  useEffect(() => {
    if (!connId) { setTopics([]); return; }
    const key = `${connId}:${scope}`;
    const cached = kafkaTopicsCache.get(key);
    if (cached) setTopics(cached); // show instantly on remount; refresh below
    let cancelled = false;
    setTopicsLoading(!cached); // only spin when there's nothing cached to show
    kafkaAPI.topics(connId, scope)
      .then((res) => {
        const list = (res.data as KafkaTopicSummary[]) ?? [];
        kafkaTopicsCache.set(key, list);
        if (!cancelled) setTopics(list);
      })
      .catch(() => { if (!cancelled && !cached) setTopics([]); })
      .finally(() => { if (!cancelled) setTopicsLoading(false); });
    return () => { cancelled = true; };
  }, [connId, scope]);

  const runFetchWith = useCallback(async (p: {
    topic: string; mode: KafkaFetchMode; n: number; partition: number; offset?: number; timestampMs?: number;
  }) => {
    if (!connId) return;
    setFetching(true);
    setFetchError('');
    try {
      const res = await kafkaAPI.consume(connId, p, scope);
      setResult(res.data as KafkaConsumeResult);
    } catch (err) {
      setFetchError(extractErr(err, t('peek.fetchFailed')));
      setResult(null);
    }
    setFetching(false);
  }, [connId, scope, t]);

  const runFetch = useCallback(() => {
    if (!topic) return;
    const p: { topic: string; mode: KafkaFetchMode; n: number; partition: number; offset?: number; timestampMs?: number } = {
      topic, mode, n: Math.max(1, n), partition,
    };
    if (mode === 'offset') p.offset = parseInt(offsetInput, 10) || 0;
    if (mode === 'timestamp') {
      const ms = new Date(timestampInput).getTime();
      if (!Number.isNaN(ms)) p.timestampMs = ms;
    }
    runFetchWith(p);
  }, [topic, mode, n, partition, offsetInput, timestampInput, runFetchWith]);

  // Auto-fetch the first time a topic becomes selected (including on mount /
  // remount if the tab already has one), using the tab's PERSISTED fetch
  // controls (N / mode / partition) — do NOT reset them here, or switching to
  // another tab and back would clobber a user-set N (e.g. 105) back to 100.
  const runFetchRef = useRef(runFetch);
  useEffect(() => { runFetchRef.current = runFetch; }, [runFetch]);
  const autoKeyRef = useRef('');
  useEffect(() => {
    // Wait until the connection row is loaded so `scope` is resolved
    // correctly (avoids an initial fetch through the wrong backend).
    if (!connId || !topic || !conn) return;
    const key = `${connId}::${topic}`;
    if (autoKeyRef.current === key) return;
    autoKeyRef.current = key;
    runFetchRef.current();
  }, [connId, topic, conn]);

  const handleConnChange = useCallback((v: string) => {
    updateTab(tab.id, { kafkaConnectionId: v, kafkaTopic: '' });
    setResult(null);
    setFetchError('');
    autoKeyRef.current = '';
  }, [tab.id, updateTab]);

  const handleTopicChange = useCallback((v: string) => {
    updateTab(tab.id, { kafkaTopic: v });
    setPartition(-1);
  }, [tab.id, updateTab]);

  const openPublish = useCallback(() => {
    setPubTopic(topic ?? '');
    setPubPartition(-1);
    setPubKey('');
    setPubValue('');
    setPubHeaders([{ key: '', value: '' }]);
    setPubError('');
    setPublishOpen(true);
  }, [topic]);

  const handlePublish = useCallback(async () => {
    if (!connId) return;
    if (!pubTopic.trim()) { setPubError(t('peek.pubTopicRequired')); return; }
    setPublishing(true);
    setPubError('');
    const headers = pubHeaders
      .filter((h) => h.key.trim())
      .map((h) => ({ key: h.key, value: h.value }));
    try {
      const res = await kafkaAPI.produce(connId, {
        topic: pubTopic.trim(),
        partition: pubPartition,
        key: pubKey,
        value: pubValue,
        headers,
      }, scope);
      const meta = res.data as { partition?: number; offset?: number };
      toast({
        title: t('peek.messagePublished'),
        description: t('peek.messagePublishedDesc', { partition: meta.partition ?? '?', offset: meta.offset ?? '?' }),
      });
      setPublishOpen(false);
      // If we published to the topic we're viewing, refresh the peek.
      if (pubTopic.trim() === topic) runFetch();
    } catch (err) {
      setPubError(extractErr(err, t('peek.publishFailed')));
    }
    setPublishing(false);
  }, [connId, pubTopic, pubHeaders, pubPartition, pubKey, pubValue, scope, toast, topic, runFetch, t]);

  const handleExport = useCallback((fmt: 'json' | 'csv') => {
    if (!result) return;
    const msgs = result.messages;
    let blob: Blob;
    let filename: string;
    if (fmt === 'json') {
      blob = new Blob([JSON.stringify(msgs, null, 2)], { type: 'application/json' });
      filename = `${topic || 'topic'}.json`;
    } else {
      const header = ['partition', 'offset', 'timestamp', 'key', 'headers', 'value'].join(',');
      const body = msgs.map((m) => [
        m.partition,
        m.offset,
        new Date(m.timestampMs).toISOString(),
        csvEscape(m.key ?? ''),
        csvEscape(m.headers ? headersTitle(m.headers).replace(/\n/g, '; ') : ''),
        csvEscape(msgUtf8(m)),
      ].join(',')).join('\n');
      blob = new Blob([header + '\n' + body], { type: 'text/csv' });
      filename = `${topic || 'topic'}.csv`;
    }
    triggerDownload(blob, filename);
  }, [result, topic]);

  // Cell-aware detail: clicking a cell shows THAT column's data (key /
  // headers / value / …), not always the value. JSON-looking content opens
  // the beautified JSON modal; everything else opens a raw cell dialog.
  const onCellClick = useCallback((m: KafkaMessage, field: MsgField) => {
    const loc = `p${m.partition} @ ${m.offset}`;
    const titleFor = (f: MsgField) => t('peek.cellTitle', { label: t(FIELD_LABEL_KEYS[f]), loc });
    if (field === 'headers') {
      const obj = Object.fromEntries((m.headers ?? []).map((h) => [h.key, h.value]));
      setJsonModal({ value: obj, label: titleFor('headers') });
      return;
    }
    let content = '';
    switch (field) {
      case 'partition': content = String(m.partition); break;
      case 'offset': content = String(m.offset); break;
      case 'timestamp':
        content = `${new Date(m.timestampMs).toLocaleString()}\n${new Date(m.timestampMs).toISOString()}\n${m.timestampMs} ms`;
        break;
      case 'key': content = m.key ?? '(null)'; break;
      default: content = msgUtf8(m); break; // 'value'
    }
    const title = titleFor(field);
    if ((field === 'value' || field === 'key') && canShowAsJson(content)) {
      setJsonModal({ value: content, label: title });
    } else {
      setRawCell({ title, content });
    }
  }, [t]);

  // ── Resizable columns ─────────────────────────────────────────────
  const widthOf = useCallback(
    (id: string, def: number) => colWidths[id] ?? def,
    [colWidths],
  );
  const startResize = useCallback((e: React.MouseEvent, id: string, cur: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(50, cur + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [id]: w }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }, []);
  const totalWidth = MSG_COLUMNS.reduce((sum, c) => sum + widthOf(c.id, c.def), 0);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div ref={lagContainerRef} className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 border-b">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
          <Radio className="h-4 w-4 text-muted-foreground" />
          <Select value={connId ?? ''} onValueChange={handleConnChange}>
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue placeholder={t('peek.selectConnection')} />
            </SelectTrigger>
            <SelectContent>
              {connections.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {t('peek.noConnections')}
                </div>
              ) : (
                connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.shared && <span className="ml-2 text-[10px] text-muted-foreground">· {c.grantRole}</span>}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <Select
            value={topic ?? ''}
            onValueChange={handleTopicChange}
            disabled={!connId}
            onOpenChange={(o) => {
              if (o) requestAnimationFrame(() => topicSearchRef.current?.focus());
              else setTopicQuery('');
            }}
          >
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue placeholder={topicsLoading ? t('peek.loadingTopics') : t('peek.selectTopic')} />
            </SelectTrigger>
            <SelectContent>
              {topics.length > 8 && (
                <div className="sticky top-0 z-10 bg-popover border-b p-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      ref={topicSearchRef}
                      value={topicQuery}
                      onChange={(e) => setTopicQuery(e.target.value)}
                      // Kill Radix Select's built-in typeahead (which would
                      // steal keystrokes), but let dismissal (Escape) and list
                      // navigation (Arrow keys) still reach the Select.
                      onKeyDown={(e) => {
                        if (!['Escape', 'ArrowDown', 'ArrowUp'].includes(e.key)) e.stopPropagation();
                      }}
                      placeholder={t('peek.searchTopics')}
                      autoFocus
                      className="h-7 pl-7 pr-2 text-xs"
                    />
                  </div>
                </div>
              )}
              {topics.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {topicsLoading ? t('common:loading') : t('peek.noTopicsFound')}
                </div>
              ) : (() => {
                // Filter at render; ALWAYS keep the selected topic in the list
                // so <SelectValue> stays populated even when it's filtered out.
                const tq = topicQuery.trim().toLowerCase();
                const shownTopics = (topics.length > 8 && tq)
                  ? topics.filter((t) => t.name.toLowerCase().includes(tq) || t.name === topic)
                  : topics;
                if (shownTopics.length === 0) {
                  return <div className="px-2 py-3 text-xs text-muted-foreground">{t('peek.noMatchingTopics')}</div>;
                }
                return shownTopics.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name}
                    <span className="ml-2 text-[10px] text-muted-foreground">{t.partitions}p</span>
                  </SelectItem>
                ));
              })()}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {connId && (
            <ExecScopePicker
              scope={scope}
              availableScopes={conn?.availableScopes}
              onChange={(s) => updateTab(tab.id, { kafkaExecScope: s })}
              noun="peek / publish"
            />
          )}

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-9"
                    disabled={!connId || !writable}
                    onClick={openPublish}
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span className="text-xs">{t('peek.publish')}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[220px]">
                  {writable
                    ? t('peek.publishTooltipWrite')
                    : t('peek.publishTooltipReadonly')}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-9 text-xs gap-1.5" disabled={!result}>
                <Download className="h-3.5 w-3.5" /> {t('peek.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('json')}>
                <FileJson className="h-3.5 w-3.5 mr-2" /> JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-2" /> CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Read-only banner */}
        <div className="px-4 pb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            {t('peek.readOnlyBanner')}
          </div>
        </div>

        {/* Fetch bar */}
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
          <Select value={mode} onValueChange={(v) => setMode(v as KafkaFetchMode)}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL_KEYS) as KafkaFetchMode[]).map((m) => (
                <SelectItem key={m} value={m}>{t(MODE_LABEL_KEYS[m])}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center h-8 rounded-md border bg-background px-2 gap-1.5">
            <span className="text-[11px] text-muted-foreground select-none">N</span>
            <Input
              type="number"
              min={1}
              value={n}
              onChange={(e) => setN(parseInt(e.target.value, 10) || 1)}
              className="h-6 w-16 text-xs px-1.5 border-0 shadow-none focus-visible:ring-0 bg-transparent"
            />
          </div>

          <Select value={String(partition)} onValueChange={(v) => setPartition(parseInt(v, 10))}>
            <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="-1">{t('peek.allPartitions')}</SelectItem>
              {Array.from({ length: partitionCount }, (_, i) => (
                <SelectItem key={i} value={String(i)}>{t('peek.partitionItem', { n: i })}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {mode === 'offset' && (
            <div className="flex items-center h-8 rounded-md border bg-background px-2 gap-1.5">
              <span className="text-[11px] text-muted-foreground select-none">{t('peek.offset')}</span>
              <Input
                type="number"
                value={offsetInput}
                onChange={(e) => setOffsetInput(e.target.value)}
                className="h-6 w-24 text-xs px-1.5 border-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
            </div>
          )}
          {mode === 'timestamp' && (
            <Input
              type="datetime-local"
              value={timestampInput}
              onChange={(e) => setTimestampInput(e.target.value)}
              className="h-8 w-[210px] text-xs"
            />
          )}

          <Button size="sm" className="gap-1.5 h-8" disabled={!topic || fetching} onClick={runFetch}>
            {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span className="text-xs">{t('peek.fetch')}</span>
          </Button>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t('peek.decodeValue')}</span>
            <Select value={decode} onValueChange={(v) => setDecode(v as DecodeMode)}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('peek.decodeAuto')}</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="utf8">UTF-8</SelectItem>
                <SelectItem value="hex">Hex</SelectItem>
                <SelectItem value="base64">Base64</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {!connId ? (
          <EmptyState text={t('peek.emptySelectConnection')} />
        ) : !topic ? (
          <EmptyState text={t('peek.emptySelectTopic')} />
        ) : fetchError ? (
          <div className="p-4 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono">{fetchError}</pre>
          </div>
        ) : fetching && !result ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('peek.fetching')}
          </div>
        ) : result ? (
          <>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: totalWidth }}>
                <colgroup>
                  {MSG_COLUMNS.map((c) => (
                    <col key={c.id} style={{ width: widthOf(c.id, c.def) }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 bg-muted/60 backdrop-blur z-10">
                  <tr className="text-left text-muted-foreground">
                    {MSG_COLUMNS.map((c) => (
                      <th
                        key={c.id}
                        className="relative font-medium px-3 py-1.5 overflow-hidden select-none"
                        style={{ width: widthOf(c.id, c.def) }}
                      >
                        <span className="truncate block pr-1">{t(c.labelKey)}</span>
                        <div
                          onMouseDown={(e) => startResize(e, c.id, widthOf(c.id, c.def))}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                          title={t('peek.dragResize')}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.messages.length === 0 ? (
                    <tr>
                      <td colSpan={MSG_COLUMNS.length} className="px-3 py-6 text-center text-muted-foreground italic">
                        {result.timedOut
                          ? t('peek.noMessagesTimedOut', { s: Math.round(result.fetchMs / 1000) })
                          : t('peek.noMessages')}
                      </td>
                    </tr>
                  ) : (
                    result.messages.map((m, i) => (
                      <tr
                        key={`${m.partition}:${m.offset}:${i}`}
                        className="border-b border-border/50 hover:bg-accent/40"
                      >
                        <td onClick={() => onCellClick(m, 'partition')} className="px-3 py-1 font-mono text-muted-foreground overflow-hidden truncate cursor-pointer">{m.partition}</td>
                        <td onClick={() => onCellClick(m, 'offset')} className="px-3 py-1 font-mono text-muted-foreground overflow-hidden truncate cursor-pointer">{m.offset}</td>
                        <td onClick={() => onCellClick(m, 'timestamp')} className="px-3 py-1 font-mono text-muted-foreground overflow-hidden truncate whitespace-nowrap cursor-pointer">
                          {new Date(m.timestampMs).toLocaleString()}
                        </td>
                        <td onClick={() => onCellClick(m, 'key')} className="px-3 py-1 font-mono overflow-hidden truncate cursor-pointer" title={m.key ?? ''}>
                          {m.key ?? <span className="italic text-muted-foreground/60">{t('peek.valueNull')}</span>}
                        </td>
                        <td onClick={() => onCellClick(m, 'headers')} className="px-3 py-1 font-mono overflow-hidden cursor-pointer">
                          {m.headers && m.headers.length > 0 ? (
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="shrink-0 text-[9px] text-muted-foreground/70 tabular-nums">
                                {m.headers.length}
                              </span>
                              <span className="block truncate text-foreground/80" title={headersTitle(m.headers)}>
                                {headersPreview(m.headers)}
                              </span>
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td onClick={() => onCellClick(m, 'value')} className="px-3 py-1 font-mono overflow-hidden cursor-pointer">
                          <span className="block truncate text-foreground/90">
                            {previewValue(m, decode)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/30 flex items-center gap-2">
              <span>{t(result.messages.length === 1 ? 'peek.messagesCountOne' : 'peek.messagesCountOther', { count: result.messages.length })}</span>
              <span>·</span>
              <span>{t('peek.partitionsSummary', { count: result.partitions })}</span>
              <span>·</span>
              <span>{t('peek.msElapsed', { ms: result.fetchMs })}</span>
              {result.truncated && (
                <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-500">{t('peek.truncated')}</Badge>
              )}
              {result.timedOut && result.messages.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[9px] border-amber-500/50 text-amber-500"
                  title={t('peek.partialHint', { s: Math.round(result.fetchMs / 1000) })}
                >
                  {t('peek.partial')}
                </Badge>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t('peek.pressFetch')}
          </div>
        )}
      </div>

      {/* Bottom pane — collapsible + resizable, Consumer Lag | Topics tabs. */}
      {connId && (
        lagCollapsed ? (
          <div className="shrink-0 border-t">
            <KafkaBottomPanel
              connId={connId}
              scope={scope}
              topic={topic}
              collapsed={lagCollapsed}
              onToggleCollapse={() => setLagCollapsed((v) => !v)}
              onSelectTopic={(t) => handleTopicChange(t)}
              activeTab={bottomTab}
              onActiveTabChange={setBottomTab}
              lagInterval={lagInterval}
              onLagIntervalChange={setLagInterval}
              layout={bottomLayout}
              onLayoutChange={changeBottomLayout}
            />
          </div>
        ) : (
          <>
            <div
              onMouseDown={onLagSplitDown}
              className="h-1 cursor-row-resize bg-border hover:bg-primary/40 shrink-0"
            />
            <div className="min-h-0 overflow-hidden border-t" style={{ flex: `0 0 ${lagRatio}%` }}>
              <KafkaBottomPanel
                connId={connId}
                scope={scope}
                topic={topic}
                collapsed={lagCollapsed}
                onToggleCollapse={() => setLagCollapsed((v) => !v)}
                onSelectTopic={(t) => handleTopicChange(t)}
                activeTab={bottomTab}
                onActiveTabChange={setBottomTab}
                lagInterval={lagInterval}
                onLagIntervalChange={setLagInterval}
                layout={bottomLayout}
                onLayoutChange={changeBottomLayout}
              />
            </div>
          </>
        )
      )}

      {/* JSON detail (value looks like JSON) */}
      {jsonModal && (
        <DBJsonModal
          open={!!jsonModal}
          onClose={() => setJsonModal(null)}
          value={jsonModal.value}
          colName={jsonModal.label}
        />
      )}

      {/* Cell detail (non-JSON cell content — key / value / part / …) */}
      <Dialog open={!!rawCell} onOpenChange={(o) => { if (!o) setRawCell(null); }}>
        <DialogContent className="max-w-2xl w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-mono">{rawCell?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto">
            <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-muted/40 rounded px-3 py-2">
              {rawCell?.content}
            </pre>
          </div>
          <div className="flex justify-end shrink-0">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs gap-1.5"
              onClick={() => { if (rawCell) navigator.clipboard.writeText(rawCell.content).catch(() => {}); }}
            >
              <Copy className="h-3 w-3" /> {t('common:copy')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Publish dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('peek.publishTitle')}</DialogTitle>
            <DialogDescription className="text-amber-500">
              {t('peek.publishWarning')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('peek.pubTopic')}</Label>
                <Input
                  value={pubTopic}
                  onChange={(e) => setPubTopic(e.target.value)}
                  className="font-mono text-xs"
                  placeholder={t('peek.pubTopicPlaceholder')}
                />
              </div>
              <div>
                <Label className="text-xs">{t('peek.pubPartition')}</Label>
                <Select value={String(pubPartition)} onValueChange={(v) => setPubPartition(parseInt(v, 10))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="-1">{t('peek.pubByKeyAuto')}</SelectItem>
                    {Array.from({ length: pubPartitionCount }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{t('peek.partitionItem', { n: i })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t('peek.pubKey')}</Label>
              <Input
                value={pubKey}
                onChange={(e) => setPubKey(e.target.value)}
                className="font-mono text-xs"
                placeholder={t('peek.pubKeyPlaceholder')}
              />
            </div>
            <div>
              <Label className="text-xs">{t('peek.pubValue')}</Label>
              <Textarea
                value={pubValue}
                onChange={(e) => setPubValue(e.target.value)}
                className="font-mono text-xs min-h-[120px]"
                placeholder='{"event":"created"}'
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">{t('peek.pubHeaders')}</Label>
                <button
                  type="button"
                  onClick={() => setPubHeaders((h) => [...h, { key: '', value: '' }])}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Plus className="h-2.5 w-2.5" /> {t('common:add')}
                </button>
              </div>
              <div className="space-y-1">
                {pubHeaders.map((h, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={h.key}
                      onChange={(e) => setPubHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                      placeholder={t('peek.headerKeyPlaceholder')}
                      className="h-7 text-xs font-mono"
                    />
                    <Input
                      value={h.value}
                      onChange={(e) => setPubHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      placeholder={t('peek.headerValuePlaceholder')}
                      className="h-7 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setPubHeaders((hs) => (hs.length > 1 ? hs.filter((_, j) => j !== i) : hs))}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {pubError && <p className="text-xs text-destructive">{pubError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={publishing}>{t('common:cancel')}</Button>
            <Button onClick={handlePublish} disabled={publishing}>
              {publishing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('peek.publishButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2">
      <Radio className="h-8 w-8 text-muted-foreground/40" />
      {text}
    </div>
  );
}

// ── value decoding ────────────────────────────────────────────────────

function msgToBytes(msg: KafkaMessage): Uint8Array {
  if (msg.valueEncoding === 'base64') {
    try {
      const bin = atob(msg.value);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    } catch {
      return new TextEncoder().encode(msg.value);
    }
  }
  return new TextEncoder().encode(msg.value);
}

function msgUtf8(msg: KafkaMessage): string {
  if (msg.valueEncoding === 'base64') {
    try { return new TextDecoder().decode(msgToBytes(msg)); } catch { return msg.value; }
  }
  return msg.value;
}

function decodeValue(msg: KafkaMessage, mode: DecodeMode): string {
  switch (mode) {
    case 'auto':
      return msg.value;
    case 'utf8':
      return msgUtf8(msg);
    case 'base64': {
      if (msg.valueEncoding === 'base64') return msg.value;
      try {
        let bin = '';
        msgToBytes(msg).forEach((b) => { bin += String.fromCharCode(b); });
        return btoa(bin);
      } catch { return msg.value; }
    }
    case 'hex':
      return Array.from(msgToBytes(msg)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    case 'json': {
      const s = msgUtf8(msg);
      try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
    }
    default:
      return msg.value;
  }
}

// headersPreview renders a compact one-line "k=v · k2=v2" summary for the
// table cell; headersTitle is the full newline-separated list for the
// hover tooltip. Header keys often carry trace ids / content-types.
function headersPreview(headers: { key: string; value: string }[]): string {
  return headers.map((h) => `${h.key}=${h.value}`).join(' · ');
}

function headersTitle(headers: { key: string; value: string }[]): string {
  return headers.map((h) => `${h.key}: ${h.value}`).join('\n');
}

function previewValue(msg: KafkaMessage, mode: DecodeMode): string {
  const full = decodeValue(msg, mode).replace(/\s+/g, ' ');
  return full.length > 600 ? full.slice(0, 600) + '…' : full;
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
