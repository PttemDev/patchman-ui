import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import {
  Database,
  Play,
  Loader2,
  Download,
  FileJson,
  FileSpreadsheet,
  AlertTriangle,
  ShieldAlert,
  Copy,
  Trash2,
  Clock,
  X,
  Terminal,
  Radio,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Search,
} from 'lucide-react';
import { redisAPI, type DBScope } from '@/services/api';
import { useRedisConnectionStore, scopeForRedis } from '@/stores/redisConnectionStore';
import { ExecScopePicker } from '@/components/common/ExecScopePicker';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import { DBJsonModal, canShowAsJson } from '@/components/dbquery/DBJsonModal';
import { RedisCheatsheet } from './RedisCheatsheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { confirmDialog } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type {
  Tab,
  KeyEntry,
  KeyListing,
  KeyMeta,
  ValueResult,
  CommandResult,
  PubSubResult,
  RedisElementRef,
} from '@/types';

interface RedisKeyPanelProps {
  tab: Tab;
}

type DecodeMode = 'auto' | 'utf8' | 'hex' | 'base64' | 'json';
type BrowseMode = 'keys' | 'pubsub';

// Semantic hue per Redis value type, matching the Kafka/S3 badge language.
const TYPE_COLORS: Record<string, string> = {
  string: 'border-sky-500/50 text-sky-500',
  hash: 'border-violet-500/50 text-violet-500',
  list: 'border-amber-500/50 text-amber-500',
  set: 'border-emerald-500/50 text-emerald-500',
  zset: 'border-pink-500/50 text-pink-500',
  stream: 'border-orange-500/50 text-orange-500',
  none: 'border-border text-muted-foreground',
};

const KEY_COLUMNS: { id: string; labelKey: string; def: number; align?: 'right'; resizable: boolean }[] = [
  { id: 'key', labelKey: 'columns.key', def: 420, resizable: true },
  { id: 'type', labelKey: 'columns.type', def: 96, resizable: true },
  { id: 'ttl', labelKey: 'columns.ttl', def: 120, align: 'right', resizable: true },
  { id: 'size', labelKey: 'columns.size', def: 104, align: 'right', resizable: true },
  { id: 'actions', labelKey: '', def: 112, resizable: false },
];

const PS_COLUMNS: { id: string; labelKey: string; def: number }[] = [
  { id: 'channel', labelKey: 'columns.channel', def: 220 },
  { id: 'pattern', labelKey: 'columns.pattern', def: 160 },
  { id: 'payload', labelKey: 'columns.payload', def: 520 },
];

// Detail drawer width: a flex sibling of the key list with a draggable /
// keyboard-resizable left edge, persisted per browser profile.
const DETAIL_WIDTH_STORAGE_KEY = 'patchman_redis_detail_width';
const DETAIL_DEFAULT_WIDTH = 440;
const DETAIL_MIN_WIDTH = 320;
// The key list always keeps at least this much room next to the drawer.
const LIST_MIN_WIDTH = 240;

function readDetailWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(DETAIL_WIDTH_STORAGE_KEY) ?? '', 10);
    if (Number.isFinite(v) && v >= DETAIL_MIN_WIDTH) return v;
  } catch { /* storage unavailable */ }
  return DETAIL_DEFAULT_WIDTH;
}

function writeDetailWidth(w: number | null) {
  try {
    if (w == null) localStorage.removeItem(DETAIL_WIDTH_STORAGE_KEY);
    else localStorage.setItem(DETAIL_WIDTH_STORAGE_KEY, String(Math.round(w)));
  } catch { /* storage unavailable */ }
}

// RedisKeyPanel is the Redis tab body: connection + DB pickers, a SCAN key
// browser, a type-aware value drawer, a write-gated command console, and a
// commit-less Pub/Sub peek. It never runs KEYS and never commits anything.
export function RedisKeyPanel({ tab }: RedisKeyPanelProps) {
  const { t } = useTranslation('redis');
  const connections = useRedisConnectionStore((s) => s.connections);
  const fetchConnections = useRedisConnectionStore((s) => s.fetchConnections);
  const updateTab = useRequestStore((s) => s.updateTab);
  const { theme } = useThemeStore();
  const { toast } = useToast();

  const connId = tab.redisConnectionId ?? '';
  const conn = useMemo(() => connections.find((c) => c.id === connId) ?? null, [connections, connId]);
  const isCluster = conn?.mode === 'cluster';
  const db = isCluster ? 0 : (tab.redisDb ?? conn?.dbIndex ?? 0);
  // Effective execution scope: per-tab override → connection home → derived.
  const scope: DBScope = tab.redisExecScope
    ?? conn?.scope
    ?? (connId ? scopeForRedis(connections, connId) : 'remote');
  // Writes need a write (or owner) role AND the connection's read-write switch.
  const readOnlyMode = !!conn && !conn.allowWrite && conn.grantRole !== 'read';
  const writable = conn ? conn.grantRole !== 'read' && !!conn.allowWrite : false;

  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  const [browseMode, setBrowseMode] = useState<BrowseMode>('keys');

  // ── SCAN state ──────────────────────────────────────────────────────
  const [match, setMatch] = useState(tab.redisKeyPattern ?? '*');
  // Matching keys wanted per page — the BE keeps SCANning (within a ~1.5s
  // budget) until this many match, so a sparse pattern isn't an empty page.
  const [count, setCount] = useState(500);
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [listing, setListing] = useState<KeyListing | null>(null);
  // The search text `listing` was produced from (to show "as *order*").
  const [listingInput, setListingInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scanError, setScanError] = useState('');

  // scanSeqRef drops out-of-order responses (a newer scan, or a connection /
  // db switch, supersedes an in-flight one). scanMatchRef pins the search
  // text a cursor was issued for, so "Load more" continues THAT scan even if
  // the box has been edited since.
  const scanSeqRef = useRef(0);
  const scanMatchRef = useRef('');
  const runScan = useCallback(async (cursor?: number) => {
    if (!connId) return;
    const seq = ++scanSeqRef.current;
    if (!cursor) scanMatchRef.current = match;
    const pattern = scanMatchRef.current;
    if (cursor) setLoadingMore(true); else { setScanning(true); setScanError(''); }
    try {
      const res = await redisAPI.scanKeys(
        connId,
        { db, match: pattern, smart: 1, count: Math.max(1, count), cursor: cursor ?? 0 },
        scope,
      );
      if (seq !== scanSeqRef.current) return;
      const data = res.data as KeyListing;
      const page = data.keys ?? [];
      setListing(data);
      setListingInput(pattern);
      setKeys((prev) => {
        if (!cursor) return page;
        // SCAN may repeat a key across pages; rows are keyed by key name.
        const seen = new Set(prev.map((k) => k.key));
        return [...prev, ...page.filter((k) => !seen.has(k.key))];
      });
    } catch (err) {
      if (seq !== scanSeqRef.current) return;
      setScanError(extractErr(err, t('toast.scanFailed')));
      if (!cursor) { setKeys([]); setListing(null); }
    } finally {
      if (seq === scanSeqRef.current) {
        setScanning(false);
        setLoadingMore(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, db, match, count, scope]);

  // Auto-scan the first page when a connection + db first resolve.
  const autoKeyRef = useRef('');
  useEffect(() => {
    if (!connId || !conn || browseMode !== 'keys') return;
    const key = `${connId}:${db}`;
    if (autoKeyRef.current === key) return;
    autoKeyRef.current = key;
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, conn, db, browseMode]);

  const handleConnChange = useCallback((v: string) => {
    updateTab(tab.id, { redisConnectionId: v });
    scanSeqRef.current++;
    setScanning(false);
    setLoadingMore(false);
    setKeys([]);
    setListing(null);
    setScanError('');
    setSelected(null);
    autoKeyRef.current = '';
  }, [tab.id, updateTab]);

  const handleDbChange = useCallback((v: string) => {
    updateTab(tab.id, { redisDb: parseInt(v, 10) || 0 });
    scanSeqRef.current++;
    setScanning(false);
    setLoadingMore(false);
    setKeys([]);
    setListing(null);
    setSelected(null);
    autoKeyRef.current = '';
  }, [tab.id, updateTab]);

  const handleMatchChange = useCallback((v: string) => {
    setMatch(v);
    updateTab(tab.id, { redisKeyPattern: v });
  }, [tab.id, updateTab]);

  // ── Detail drawer ───────────────────────────────────────────────────
  const [selected, setSelected] = useState<KeyEntry | null>(null);
  const [value, setValue] = useState<ValueResult | null>(null);
  const [meta, setMeta] = useState<KeyMeta | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decode, setDecode] = useState<DecodeMode>('auto');
  const [jsonModal, setJsonModal] = useState<{ value: unknown; label: string } | null>(null);

  // detailSeqRef drops a value/meta response for a key that is no longer
  // the selected one (fast clicking, or a refresh racing a new selection).
  const detailSeqRef = useRef(0);

  const closeDetail = useCallback(() => {
    detailSeqRef.current++;
    setSelected(null);
    setValue(null);
    setMeta(null);
    setDetailLoading(false);
  }, []);

  const selectedRef = useRef<KeyEntry | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // A key that vanished (deleted, expired, or emptied by removing its last
  // element) drops out of the list and closes the drawer if it was open.
  const dropKey = useCallback((key: string) => {
    setKeys((prev) => prev.filter((k) => k.key !== key));
    if (selectedRef.current?.key === key) closeDetail();
  }, [closeDetail]);

  // loadDetail fetches value + meta for a key. `refresh` keeps the current
  // view (decode mode, old value) on screen until the new one lands.
  const loadDetail = useCallback(async (entry: KeyEntry, refresh = false) => {
    const seq = ++detailSeqRef.current;
    if (!refresh) {
      setSelected(entry);
      setValue(null);
      setMeta(null);
      setDecode('auto');
    }
    setDetailLoading(!refresh);
    try {
      const [vRes, mRes] = await Promise.all([
        redisAPI.getValue(connId, { db, key: entry.key }, scope),
        redisAPI.keyMeta(connId, { db, key: entry.key }, scope),
      ]);
      if (seq !== detailSeqRef.current) return;
      const v = vRes.data as ValueResult;
      const m = mRes.data as KeyMeta;
      setValue(v);
      setMeta(m);
      // Keep the list row in step with what the drawer now shows.
      setKeys((prev) => prev.map((k) => (k.key === entry.key
        ? { ...k, type: m.type, ttlMs: m.pttlMs, sizeBytes: m.memoryBytes }
        : k)));
    } catch (err) {
      if (seq !== detailSeqRef.current) return;
      const msg = extractErr(err, '');
      // Gone since it was listed (expired / deleted / emptied) → drop the row.
      if (msg === 'key not found') dropKey(entry.key);
      if (refresh && msg === 'key not found') return;
      toast({ title: t('toast.loadFailed'), description: msg || t('toast.couldNotReadKey'), variant: 'destructive' });
    } finally {
      if (seq === detailSeqRef.current) setDetailLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, db, scope, toast, dropKey]);

  const openKey = useCallback((entry: KeyEntry) => { void loadDetail(entry); }, [loadDetail]);

  // ── Detail drawer width ────────────────────────────────────────────
  const browserRowRef = useRef<HTMLDivElement>(null);
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const maxDetailWidth = useCallback(() => {
    const row = browserRowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    return Math.max(DETAIL_MIN_WIDTH, Math.round(row - LIST_MIN_WIDTH));
  }, []);
  const clampDetailWidth = useCallback(
    (w: number) => Math.round(Math.min(Math.max(w, DETAIL_MIN_WIDTH), maxDetailWidth())),
    [maxDetailWidth],
  );

  // ── Write actions ───────────────────────────────────────────────────
  // Every delete is offered only while `writable` (write grant + the
  // connection's read-write switch) and always asks first; the BE enforces
  // the same gate (403) regardless of what the UI shows.
  const [ttlTarget, setTtlTarget] = useState<KeyEntry | null>(null);
  const [ttlInput, setTtlInput] = useState('60');
  const [busy, setBusy] = useState(false);

  const handleCopyKey = useCallback((key: string) => {
    navigator.clipboard.writeText(key).catch(() => { /* ignore */ });
    toast({ title: t('toast.keyCopied') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const handleDeleteKey = useCallback(async (target: KeyEntry) => {
    if (!writable) return;
    const ok = await confirmDialog({
      title: t('deleteDialog.title', { name: target.key }),
      description: t('deleteDialog.description'),
      confirmLabel: t('common:delete'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await redisAPI.deleteKey(connId, { db, key: target.key }, scope);
      toast({ title: t('toast.deleted'), description: target.key });
      dropKey(target.key);
    } catch (err) {
      toast({ title: t('toast.deleteFailed'), description: extractErr(err, t('toast.couldNotDelete')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writable, connId, db, scope, dropKey, toast]);

  // Remove one element of the open collection key (HDEL / SREM / ZREM /
  // XDEL; a list element is removed by position, only if it still holds the
  // value shown). Always refreshes the drawer afterwards — also on a 409
  // ("nothing deleted"), so the user sees the current state.
  const handleRemoveElement = useCallback(async (ref: RedisElementRef) => {
    const entry = selected;
    if (!entry || !writable) return;
    const ok = await confirmDialog({
      ...elementConfirmText(ref, entry.key, t),
      confirmLabel: t('common:delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await redisAPI.removeElement(connId, { db, key: entry.key, ...ref }, scope);
      const data = res.data as { removed: number; keyExists: boolean };
      if (!data.keyExists) {
        toast({ title: t('toast.keyEmptied', { defaultValue: 'Key removed — it had no elements left' }), description: entry.key });
        dropKey(entry.key);
        return;
      }
      toast({ title: t('toast.elementDeleted', { defaultValue: 'Element deleted' }) });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast({
        title: status === 409
          ? t('toast.elementGone', { defaultValue: 'Nothing deleted' })
          : t('toast.deleteFailed'),
        description: extractErr(err, t('toast.couldNotDelete')),
        variant: 'destructive',
      });
    }
    await loadDetail(entry, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, writable, connId, db, scope, dropKey, loadDetail, toast]);

  const handleSetTTL = useCallback(async () => {
    const target = ttlTarget;
    if (!target) return;
    const ttlSec = parseInt(ttlInput, 10);
    if (Number.isNaN(ttlSec)) return;
    setBusy(true);
    try {
      await redisAPI.setTTL(connId, { db, key: target.key, ttlSec }, scope);
      toast({ title: t('toast.ttlUpdated'), description: `${target.key} → ${ttlSec > 0 ? t('toast.ttlSeconds', { n: ttlSec }) : t('toast.ttlPersisted')}` });
      setTtlTarget(null);
      // The BE PERSISTs for ttlSec <= 0 (no expiry → -1).
      const newMs = ttlSec > 0 ? ttlSec * 1000 : -1;
      setKeys((prev) => prev.map((k) => (k.key === target.key ? { ...k, ttlMs: newMs } : k)));
      if (selectedRef.current?.key === target.key) void loadDetail(target, true);
    } catch (err) {
      toast({ title: t('toast.setTtlFailed'), description: extractErr(err, t('toast.couldNotSetTtl')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttlTarget, ttlInput, connId, db, scope, toast, loadDetail]);

  // ── Command console ─────────────────────────────────────────────────
  const consoleRef = useRef<HTMLDivElement>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleRatio, setConsoleRatio] = useState(40);
  const [consoleInput, setConsoleInput] = useState('PING\n');
  const [consoleWrites, setConsoleWrites] = useState(false);
  const [consoleRunning, setConsoleRunning] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  // Insert a cheatsheet example into the console (opening it if collapsed).
  const insertToConsole = useCallback((snippet: string) => {
    setConsoleOpen(true);
    setConsoleInput((prev) => {
      const base = prev.replace(/\s+$/, '');
      return base ? `${base}\n${snippet}\n` : `${snippet}\n`;
    });
  }, []);
  const [history, setHistory] = useState<Array<{ cmd: string; result?: CommandResult; error?: string }>>([]);

  // Read grant can never enable writes.
  useEffect(() => { if (!writable) setConsoleWrites(false); }, [writable]);

  const runConsole = useCallback(async () => {
    if (!connId) return;
    const lines = consoleInput
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setConsoleRunning(true);
    for (const line of lines) {
      const args = splitArgs(line);
      if (args.length === 0) continue;
      try {
        const res = await redisAPI.runCommand(connId, { db, args, allowWrite: consoleWrites }, scope);
        setHistory((h) => [{ cmd: line, result: res.data as CommandResult }, ...h].slice(0, 100));
      } catch (err) {
        setHistory((h) => [{ cmd: line, error: extractErr(err, t('toast.commandFailed')) }, ...h].slice(0, 100));
      }
    }
    setConsoleRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, db, scope, consoleInput, consoleWrites]);

  const onConsoleSplitDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = consoleRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = Math.min(Math.max(((rect.bottom - ev.clientY) / rect.height) * 100, 20), 70);
      setConsoleRatio(pct);
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

  // ── Pub/Sub peek ────────────────────────────────────────────────────
  const [psInput, setPsInput] = useState('');
  const [psPattern, setPsPattern] = useState(false);
  const [psN, setPsN] = useState(20);
  const [psResult, setPsResult] = useState<PubSubResult | null>(null);
  const [psLoading, setPsLoading] = useState(false);
  const [psError, setPsError] = useState('');

  const runPeek = useCallback(async () => {
    if (!connId) return;
    setPsLoading(true);
    setPsError('');
    try {
      const body = psPattern
        ? { pattern: psInput.trim(), n: Math.max(1, psN) }
        : { channels: psInput.split(',').map((s) => s.trim()).filter(Boolean), n: Math.max(1, psN) };
      const res = await redisAPI.pubsubPeek(connId, body, scope);
      setPsResult(res.data as PubSubResult);
    } catch (err) {
      setPsError(extractErr(err, t('toast.peekFailed')));
      setPsResult(null);
    } finally {
      setPsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, psInput, psPattern, psN, scope]);

  // ── Export ──────────────────────────────────────────────────────────
  const handleExport = useCallback((fmt: 'json' | 'csv') => {
    if (keys.length === 0) return;
    let blob: Blob;
    if (fmt === 'json') {
      blob = new Blob([JSON.stringify(keys, null, 2)], { type: 'application/json' });
    } else {
      const header = ['key', 'type', 'ttlMs', 'sizeBytes'].join(',');
      const body = keys.map((k) => [csvEscape(k.key), k.type, k.ttlMs, k.sizeBytes].join(',')).join('\n');
      blob = new Blob([header + '\n' + body], { type: 'text/csv' });
    }
    triggerDownload(blob, `redis-keys-db${db}.${fmt}`);
  }, [keys, db]);

  // ── Resizable columns ───────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const widthOf = useCallback((id: string, def: number) => colWidths[id] ?? def, [colWidths]);
  const startResize = useCallback((e: React.MouseEvent, id: string, cur: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => setColWidths((p) => ({ ...p, [id]: Math.max(60, cur + (ev.clientX - startX)) }));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }, []);
  const totalWidth = KEY_COLUMNS.reduce((s, c) => s + widthOf(c.id, c.def), 0);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div ref={consoleRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
          <Database className="h-4 w-4 text-muted-foreground" />
          <Select value={connId} onValueChange={handleConnChange}>
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue placeholder={t('panel.selectConnPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {connections.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {t('panel.noConnectionsHint')}
                </div>
              ) : (
                connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-mono text-[10px] mr-2 text-muted-foreground uppercase">{c.mode}</span>
                    {c.name}
                    {c.shared && <span className="ml-2 text-[10px] text-muted-foreground">· {t(`roles.${c.grantRole ?? 'read'}`)}</span>}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {!isCluster && (
            <Select value={String(db)} onValueChange={handleDbChange} disabled={!connId}>
              <SelectTrigger className="w-[110px] h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 16 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>{t('panel.dbOption', { n: i })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={browseMode} onValueChange={(v) => setBrowseMode(v as BrowseMode)} disabled={!connId}>
            <SelectTrigger className="w-[130px] h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="keys">{t('panel.keyBrowser')}</SelectItem>
              <SelectItem value="pubsub">{t('panel.pubsubPeek')}</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {connId && (
            <ExecScopePicker
              scope={scope}
              availableScopes={conn?.availableScopes}
              onChange={(s) => updateTab(tab.id, { redisExecScope: s })}
              noun="scan"
            />
          )}

          <Button
            size="sm"
            variant={cheatsheetOpen ? 'secondary' : 'ghost'}
            className="gap-1.5 h-9"
            onClick={() => setCheatsheetOpen((o) => !o)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="text-xs">{t('panel.cheatsheet')}</span>
          </Button>

          <Button
            size="sm"
            variant={consoleOpen ? 'secondary' : 'ghost'}
            className="gap-1.5 h-9"
            disabled={!connId}
            onClick={() => setConsoleOpen((o) => !o)}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span className="text-xs">{t('panel.console')}</span>
            {consoleOpen ? <ChevronDown className="h-3 w-3 opacity-70" /> : <ChevronUp className="h-3 w-3 opacity-70" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-9 text-xs gap-1.5" disabled={keys.length === 0}>
                <Download className="h-3.5 w-3.5" /> {t('panel.export')}
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
        {conn && !writable && (
          <div className="px-4 pb-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              {readOnlyMode ? t('panel.readOnlyModeBanner') : t('panel.readOnlyBanner')}
            </div>
          </div>
        )}

        {/* Scan bar / Pub-Sub bar */}
        {browseMode === 'keys' ? (
          <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
            <div
              className="flex items-center h-8 rounded-md border bg-background px-2 gap-1.5 flex-1 min-w-[200px] max-w-[420px]"
              title={t('panel.matchHint', { defaultValue: 'Plain text matches anywhere in the key (order → *order*). Use * ? [ ] for an exact glob, e.g. order:*' })}
            >
              <span className="text-[11px] text-muted-foreground select-none">{t('panel.matchLabel')}</span>
              <Input
                value={match}
                onChange={(e) => handleMatchChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runScan(); }}
                placeholder="order · user:* · *:123"
                className="h-6 text-xs px-1.5 border-0 shadow-none focus-visible:ring-0 bg-transparent font-mono"
              />
            </div>
            <div
              className="flex items-center h-8 rounded-md border bg-background px-2 gap-1.5"
              title={t('panel.countHint', { defaultValue: 'How many matching keys to load per page. The scan keeps going until this many match or about 1.5 s has passed.' })}
            >
              <span className="text-[11px] text-muted-foreground select-none">{t('panel.countLabel')}</span>
              <Input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                className="h-6 w-16 text-xs px-1.5 border-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
            </div>
            <Button size="sm" className="gap-1.5 h-8" disabled={!connId || scanning} onClick={() => runScan()}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              <span className="text-xs">{t('panel.scan')}</span>
            </Button>
            {listing && (
              <span className="text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground">{keys.length}</span> {t(keys.length === 1 ? 'panel.keyUnitOne' : 'panel.keyUnitOther')}
                {' · '}<span className="font-mono text-foreground">{listing.scanMs}</span> ms
                {listing.pattern && listing.pattern !== listingInput.trim() && (
                  <>{' · '}{t('panel.matchedAs', { defaultValue: 'as' })} <span className="font-mono text-foreground">{listing.pattern}</span></>
                )}
                {listing.complete && ` · ${t('panel.complete')}`}
                {!listing.complete && listing.stopReason === 'limit' && keys.length > 0
                  && ` · ${t('panel.stoppedLimit', { defaultValue: 'more keys may match' })}`}
                {!listing.complete && listing.stopReason === 'budget'
                  && ` · ${t('panel.stoppedBudget', { defaultValue: 'scan paused after {{ms}} ms — more keys may match', ms: listing.scanMs })}`}
              </span>
            )}
          </div>
        ) : (
          <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px] text-amber-500 w-full">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              {t('panel.commitlessPeek')}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[11px] text-muted-foreground">{t('panel.patternLabel')}</Label>
              <Switch checked={psPattern} onCheckedChange={setPsPattern} />
            </div>
            <Input
              value={psInput}
              onChange={(e) => setPsInput(e.target.value)}
              placeholder={psPattern ? 'news.*' : 'channel1, channel2'}
              className="h-8 text-xs font-mono flex-1 min-w-[200px] max-w-[420px]"
            />
            <div className="flex items-center h-8 rounded-md border bg-background px-2 gap-1.5">
              <span className="text-[11px] text-muted-foreground select-none">N</span>
              <Input
                type="number"
                min={1}
                value={psN}
                onChange={(e) => setPsN(parseInt(e.target.value, 10) || 1)}
                className="h-6 w-14 text-xs px-1.5 border-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
            </div>
            <Button size="sm" className="gap-1.5 h-8" disabled={!connId || psLoading || !psInput.trim()} onClick={runPeek}>
              {psLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
              <span className="text-xs">{t('panel.peek')}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Body row: optional cheatsheet (left) + browser/console split (right) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {cheatsheetOpen && (
          <RedisCheatsheet onInsert={insertToConsole} onClose={() => setCheatsheetOpen(false)} />
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className="min-h-0 overflow-hidden flex"
          style={consoleOpen ? { flex: `1 1 ${100 - consoleRatio}%` } : { flex: '1 1 auto' }}
        >
          {/* Browser area + resizable detail drawer (flex siblings: the drawer
              reserves real width and the key list reflows / scrolls). */}
          <div ref={browserRowRef} className="flex-1 min-h-0 min-w-0 relative flex">
            <div className="flex-1 min-h-0 min-w-0 overflow-auto">
              {!connId ? (
                <CenterHint icon={<Database className="h-8 w-8 text-muted-foreground/40" />} text={t('hints.selectConnBrowse')} />
              ) : browseMode === 'pubsub' ? (
                psError ? (
                  <ErrorBlock text={psError} />
                ) : psLoading && !psResult ? (
                  <CenterHint icon={<Loader2 className="h-4 w-4 animate-spin" />} text={t('hints.subscribing')} />
                ) : psResult ? (
                  <PubSubGrid result={psResult} onCell={(v, l) => setJsonModal({ value: v, label: l })} />
                ) : (
                  <CenterHint text={t('hints.enterChannel')} />
                )
              ) : scanError ? (
                <ErrorBlock text={scanError} />
              ) : scanning && keys.length === 0 ? (
                <CenterHint icon={<Loader2 className="h-4 w-4 animate-spin" />} text={t('hints.scanning')} />
              ) : keys.length === 0 ? (
                listing && !listing.complete ? (
                  // A paused scan with no hits yet is NOT "no keys matched" —
                  // the rest of the keyspace hasn't been looked at.
                  <CenterHint
                    icon={<Search className="h-6 w-6 text-muted-foreground/40" />}
                    text={t('hints.noMatchesYet', { defaultValue: 'No matches in the part of the keyspace scanned so far.' })}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs mt-1"
                      disabled={loadingMore}
                      onClick={() => runScan(listing.cursor)}
                    >
                      {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                      {t('panel.continueScan', { defaultValue: 'Continue scanning' })}
                    </Button>
                  </CenterHint>
                ) : (
                  <CenterHint text={t('hints.noKeysMatched')} />
                )
              ) : (
                <table className="text-xs" style={{ tableLayout: 'fixed', width: totalWidth }}>
                  <colgroup>
                    {KEY_COLUMNS.map((c) => <col key={c.id} style={{ width: widthOf(c.id, c.def) }} />)}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {KEY_COLUMNS.map((c) => (
                        <th
                          key={c.id}
                          className={cn('relative font-semibold px-3 py-1.5 overflow-hidden select-none', c.align === 'right' ? 'text-right' : 'text-left')}
                        >
                          <span className="truncate block">{c.labelKey ? t(c.labelKey) : ''}</span>
                          {c.resizable && (
                            <div
                              onMouseDown={(e) => startResize(e, c.id, widthOf(c.id, c.def))}
                              className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                              title={t('panel.dragToResize')}
                            />
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((entry) => (
                      <tr
                        key={entry.key}
                        onClick={() => openKey(entry)}
                        className={cn(
                          'group border-b border-border/50 cursor-pointer hover:bg-accent/40',
                          selected?.key === entry.key && 'bg-accent/60',
                        )}
                      >
                        <td className="px-3 py-1.5 overflow-hidden">
                          <span className="truncate block font-mono">{entry.key}</span>
                        </td>
                        <td className="px-3 py-1.5 overflow-hidden">
                          <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0', TYPE_COLORS[entry.type] ?? TYPE_COLORS.none)}>
                            {entry.type}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground overflow-hidden truncate">
                          {formatTTL(entry.ttlMs)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground overflow-hidden truncate">
                          {humanSize(entry.sizeBytes)}
                        </td>
                        <td className="px-1 py-0.5 overflow-hidden">
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <RowAction title={t('detail.copyKey')} onClick={(e) => { e.stopPropagation(); handleCopyKey(entry.key); }}>
                              <Copy className="h-3.5 w-3.5" />
                            </RowAction>
                            {writable && (
                              <RowAction title={t('detail.setTtl')} onClick={(e) => { e.stopPropagation(); setTtlTarget(entry); setTtlInput(entry.ttlMs > 0 ? String(Math.round(entry.ttlMs / 1000)) : '60'); }}>
                                <Clock className="h-3.5 w-3.5" />
                              </RowAction>
                            )}
                            {writable && (
                              <RowAction title={t('detail.deleteKey', { defaultValue: 'Delete key' })} destructive onClick={(e) => { e.stopPropagation(); void handleDeleteKey(entry); }}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </RowAction>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {browseMode === 'keys' && listing && !listing.complete && keys.length > 0 && !scanError && (
                <div className="p-3 flex justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={loadingMore}
                    onClick={() => runScan(listing.cursor)}
                  >
                    {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    {t('panel.loadMore')}
                  </Button>
                </div>
              )}
            </div>

            {/* Detail drawer */}
            {selected && (
              <div
                className="relative shrink-0 border-l bg-background flex flex-col overflow-hidden"
                style={{ width: detailWidth, minWidth: DETAIL_MIN_WIDTH, maxWidth: `calc(100% - ${LIST_MIN_WIDTH}px)` }}
              >
                <PanelResizeHandle
                  width={detailWidth}
                  min={DETAIL_MIN_WIDTH}
                  getMax={maxDetailWidth}
                  clamp={clampDetailWidth}
                  onChange={setDetailWidth}
                  onCommit={writeDetailWidth}
                  onReset={() => { setDetailWidth(clampDetailWidth(DETAIL_DEFAULT_WIDTH)); writeDetailWidth(null); }}
                  label={t('panel.dragToResize')}
                  title={t('panel.resizeDetailHint', { defaultValue: 'Drag or use ←/→ to resize · double-click to reset' })}
                />
                <header className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 shrink-0', TYPE_COLORS[selected.type] ?? TYPE_COLORS.none)}>
                      {selected.type}
                    </Badge>
                    <span className="text-xs font-mono truncate" title={selected.key}>{selected.key}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {writable && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => void handleDeleteKey(selected)}
                        disabled={busy}
                        title={t('detail.deleteKey', { defaultValue: 'Delete key' })}
                        aria-label={t('detail.deleteKey', { defaultValue: 'Delete key' })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={closeDetail} aria-label={t('common:close')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </header>

                <div className="flex-1 overflow-auto p-3 space-y-3">
                  {detailLoading ? (
                    <p className="text-xs text-muted-foreground italic">{t('detail.loadingValue')}</p>
                  ) : (
                    <>
                      <div className="border rounded-md divide-y text-xs">
                        <MetaRow k={t('detail.metaType')} v={meta?.type ?? selected.type} />
                        {meta?.encoding && <MetaRow k={t('detail.encoding')} v={meta.encoding} mono />}
                        <MetaRow k={t('detail.ttl')} v={formatTTL(meta?.pttlMs ?? selected.ttlMs)} />
                        <MetaRow k={t('detail.memory')} v={humanSize(meta?.memoryBytes ?? selected.sizeBytes)} />
                        {meta && <MetaRow k={t('detail.length')} v={String(meta.length)} />}
                      </div>

                      {value && (
                        <ValueViewer
                          value={value}
                          decode={decode}
                          setDecode={setDecode}
                          onJson={(v, l) => setJsonModal({ value: v, label: l })}
                          onRemove={writable ? (ref) => void handleRemoveElement(ref) : undefined}
                        />
                      )}
                    </>
                  )}
                </div>

                <footer className="flex items-center gap-1.5 px-3 py-2 border-t shrink-0">
                  <Button size="sm" variant="secondary" className="h-8 text-xs gap-1.5" onClick={() => handleCopyKey(selected.key)}>
                    <Copy className="h-3.5 w-3.5" /> {t('detail.copyKey')}
                  </Button>
                  {writable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => { setTtlTarget(selected); setTtlInput(selected.ttlMs > 0 ? String(Math.round(selected.ttlMs / 1000)) : '60'); }}
                    >
                      <Clock className="h-3.5 w-3.5" /> {t('detail.setTtl')}
                    </Button>
                  )}
                </footer>
              </div>
            )}
          </div>
        </div>

        {/* Command console (collapsible bottom split) */}
        {consoleOpen && (
          <>
            <div onMouseDown={onConsoleSplitDown} className="h-1 cursor-row-resize bg-border hover:bg-primary/40 shrink-0" />
            <div className="min-h-0 overflow-hidden border-t flex flex-col" style={{ flex: `0 0 ${consoleRatio}%` }}>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 bg-muted/30">
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground">{t('console.title')}</span>
                <div className="flex-1" />
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[11px] text-muted-foreground">{t('console.writesEnabled')}</Label>
                        <Switch checked={consoleWrites} onCheckedChange={setConsoleWrites} disabled={!writable} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs max-w-[220px]">
                        {writable
                          ? t('console.writesTooltipOn')
                          : readOnlyMode ? t('panel.readOnlyModeBanner') : t('console.writesTooltipReadonly')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button size="sm" className="h-7 text-xs gap-1.5" disabled={!connId || consoleRunning} onClick={runConsole}>
                  {consoleRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {t('console.run')}
                </Button>
              </div>
              <div className="flex-1 min-h-0 flex">
                <div className="w-1/2 min-w-0 border-r">
                  <CodeEditor
                    height="100%"
                    language="redis"
                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                    value={consoleInput}
                    onChange={(v) => setConsoleInput(v ?? '')}
                    options={{
                      fontSize: 13,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: 'off',
                      wordWrap: 'on',
                      automaticLayout: true,
                      padding: { top: 8 },
                      suggestOnTriggerCharacters: true,
                      quickSuggestions: { other: true, comments: false, strings: false },
                    }}
                  />
                </div>
                <div className="w-1/2 min-w-0 overflow-auto p-2 space-y-2 font-mono text-[11px]">
                  {history.length === 0 ? (
                    <p className="text-muted-foreground italic">{t('console.emptyHint')}</p>
                  ) : (
                    history.map((h, i) => (
                      <div key={i} className="border rounded-md overflow-hidden">
                        <div className="flex items-center gap-2 px-2 py-1 bg-muted/40 border-b">
                          <span className="text-muted-foreground">&gt;</span>
                          <span className="truncate">{h.cmd}</span>
                          {h.result?.write && <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/50 text-amber-500 ml-auto shrink-0">{t('roles.write')}</Badge>}
                        </div>
                        <pre className={cn('px-2 py-1 whitespace-pre-wrap break-words', h.error ? 'text-destructive' : 'text-foreground/90')}>
                          {h.error ?? renderReply(h.result)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
        </div>
      </div>

      {/* JSON modal */}
      {jsonModal && (
        <DBJsonModal
          open={!!jsonModal}
          onClose={() => setJsonModal(null)}
          value={jsonModal.value}
          colName={jsonModal.label}
        />
      )}

      {/* Set TTL dialog */}
      <Dialog open={!!ttlTarget} onOpenChange={(o) => { if (!o) setTtlTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('ttlDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-mono break-all">{ttlTarget?.key}</p>
            <Label className="text-xs">{t('ttlDialog.seconds')}</Label>
            <Input
              type="number"
              value={ttlInput}
              onChange={(e) => setTtlInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSetTTL(); }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setTtlTarget(null)}>{t('common:cancel')}</Button>
            <Button onClick={handleSetTTL} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('ttlDialog.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ── Value viewer ─────────────────────────────────────────────────────────
// onRemove is passed only in read-write mode; it adds a per-element delete
// button (hash field, list element, set / sorted-set member, stream entry).
function ValueViewer({
  value, decode, setDecode, onJson, onRemove,
}: {
  value: ValueResult;
  decode: DecodeMode;
  setDecode: (m: DecodeMode) => void;
  onJson: (v: unknown, label: string) => void;
  onRemove?: (ref: RedisElementRef) => void;
}) {
  const { t } = useTranslation('redis');
  if (value.type === 'string') {
    const decoded = decodeStr(value, decode);
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('detail.value')}</span>
          <div className="flex items-center gap-1.5">
            {canShowAsJson(decoded) && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => onJson(decoded, value.key)}>
                <FileJson className="h-3 w-3 mr-1" /> JSON
              </Button>
            )}
            <Select value={decode} onValueChange={(v) => setDecode(v as DecodeMode)}>
              <SelectTrigger className="w-[100px] h-6 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('detail.decodeAuto')}</SelectItem>
                <SelectItem value="utf8">{t('detail.decodeUtf8')}</SelectItem>
                <SelectItem value="json">{t('detail.decodeJson')}</SelectItem>
                <SelectItem value="hex">{t('detail.decodeHex')}</SelectItem>
                <SelectItem value="base64">{t('detail.decodeBase64')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-words border rounded-md p-2 bg-muted/30 max-h-[420px] overflow-auto">
          {decoded}
        </pre>
      </div>
    );
  }

  const removeLabel = t('detail.deleteElement', { defaultValue: 'Delete' });
  if (value.type === 'hash' && value.hash) {
    return (
      <TwoColTable
        rows={Object.entries(value.hash)}
        left={t('detail.field')}
        right={t('detail.value')}
        truncated={value.truncated}
        removeLabel={removeLabel}
        onRemoveRow={onRemove ? ([field]) => onRemove({ type: 'hash', field }) : undefined}
      />
    );
  }
  if (value.type === 'zset' && value.zset) {
    return (
      <TwoColTable
        rows={value.zset.map((z) => [z.member, String(z.score)])}
        left={t('detail.member')}
        right={t('detail.score')}
        truncated={value.truncated}
        removeLabel={removeLabel}
        onRemoveRow={onRemove ? ([member]) => onRemove({ type: 'zset', member }) : undefined}
      />
    );
  }
  if (value.type === 'stream' && value.stream) {
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('detail.entries')}{value.truncated && ` · ${t('panel.truncated')}`}</span>
        <div className="border rounded-md divide-y">
          {value.stream.map((e, i) => (
            <div key={i} className="group px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sky-500 flex-1 min-w-0 truncate">{e.id}</span>
                {onRemove && (
                  <ElementRemoveButton label={removeLabel} onClick={() => onRemove({ type: 'stream', entryId: e.id })} />
                )}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {Object.entries(e.fields).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="font-mono break-all">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const rows = value.type === 'list' ? value.list : value.type === 'set' ? value.set : undefined;
  if (rows) {
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {value.type === 'list' ? t('detail.elements') : t('detail.members')}{value.truncated && ` · ${t('panel.truncated')}`}
        </span>
        <div className="border rounded-md divide-y font-mono text-[11px]">
          {rows.map((r, i) => (
            <div key={i} className="group px-2 py-1 flex items-start gap-2">
              {value.type === 'list' && <span className="text-muted-foreground shrink-0 tabular-nums">{i}</span>}
              <span className="break-all flex-1 min-w-0">{r}</span>
              {onRemove && (
                <ElementRemoveButton
                  label={removeLabel}
                  onClick={() => onRemove(value.type === 'list'
                    ? { type: 'list', index: i, value: r }
                    : { type: 'set', member: r })}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground italic">{t('detail.noValue')}</p>;
}

function TwoColTable({ rows, left, right, truncated, onRemoveRow, removeLabel }: {
  rows: [string, string][];
  left: string;
  right: string;
  truncated?: boolean;
  onRemoveRow?: (row: [string, string]) => void;
  removeLabel?: string;
}) {
  const { t } = useTranslation('redis');
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {left} / {right}{truncated && ` · ${t('panel.truncated')}`}
      </span>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-[11px]">
          <tbody>
            {rows.map(([k, v], i) => (
              <tr key={i} className="group border-b border-border/50 last:border-0">
                <td className="px-2 py-1 font-mono align-top text-muted-foreground break-all w-[40%]">{k}</td>
                <td className="px-2 py-1 font-mono align-top break-all">{v}</td>
                {onRemoveRow && (
                  <td className="w-7 pr-1 py-0.5 align-top">
                    <ElementRemoveButton label={removeLabel ?? ''} onClick={() => onRemoveRow([k, v])} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PubSubGrid({ result, onCell }: { result: PubSubResult; onCell: (v: unknown, label: string) => void }) {
  const { t } = useTranslation('redis');
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {PS_COLUMNS.map((c) => <col key={c.id} style={{ width: c.def }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur border-b text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {PS_COLUMNS.map((c) => <th key={c.id} className="text-left font-semibold px-3 py-1.5">{t(c.labelKey)}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.messages.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground italic">{t('hints.noMessages')}</td></tr>
            ) : (
              result.messages.map((m, i) => {
                const payload = decodePayload(m.payload, m.payloadEncoding);
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-accent/40 cursor-pointer" onClick={() => onCell(canShowAsJson(payload) ? payload : payload, `${t('columns.payload')} · ${m.channel}`)}>
                    <td className="px-3 py-1 font-mono overflow-hidden truncate">{m.channel}</td>
                    <td className="px-3 py-1 font-mono text-muted-foreground overflow-hidden truncate">{m.pattern || '—'}</td>
                    <td className="px-3 py-1 font-mono overflow-hidden truncate">{payload.replace(/\s+/g, ' ').slice(0, 600)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/30 flex items-center gap-2">
        <span><span className="font-mono text-foreground">{result.messages.length}</span> {t(result.messages.length === 1 ? 'panel.messageUnitOne' : 'panel.messageUnitOther')}</span>
        <span>·</span>
        <span><span className="font-mono text-foreground">{result.fetchMs}</span> ms</span>
        {result.truncated && <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-500">{t('panel.truncated')}</Badge>}
      </div>
    </div>
  );
}

function RowAction({ title, onClick, destructive, children }: { title: string; onClick: (e: React.MouseEvent) => void; destructive?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground',
        destructive && 'hover:text-destructive hover:bg-destructive/10',
      )}
    >
      {children}
    </button>
  );
}

function MetaRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="px-2 py-1.5 flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground min-w-[72px] shrink-0 pt-px">{k}</span>
      <span className={cn('flex-1 break-all', mono && 'font-mono')}>{v}</span>
    </div>
  );
}

function CenterHint({ text, icon, children }: { text: string; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground p-8 text-center">
      {icon}
      {text}
      {children}
    </div>
  );
}

// Per-element delete button: revealed on row hover / keyboard focus.
function ElementRemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-opacity"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  );
}

// PanelResizeHandle is the drawer's left edge: drag (pointer events, so
// mouse / pen / touch), ←/→ (Shift = bigger steps), Home/End, and
// double-click to reset. The panel is anchored right, so moving the edge
// left widens it.
function PanelResizeHandle({
  width, min, getMax, clamp, onChange, onCommit, onReset, label, title,
}: {
  width: number;
  min: number;
  getMax: () => number;
  clamp: (w: number) => number;
  onChange: (w: number) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
  label: string;
  title: string;
}) {
  // The stored width can exceed what fits now (CSS max-width clamps the box),
  // so drags / key steps start from the RENDERED width — no dead zone.
  const renderedWidth = (el: HTMLElement) => Math.round(el.parentElement?.getBoundingClientRect().width ?? width);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = renderedWidth(el);
    let last = startW;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev: PointerEvent) => {
      last = clamp(startW + (startX - ev.clientX));
      onChange(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (last !== startW) onCommit(last);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const cur = renderedWidth(e.currentTarget);
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = cur + step;
    else if (e.key === 'ArrowRight') next = cur - step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = getMax();
    if (next == null) return;
    e.preventDefault();
    const w = clamp(next);
    onChange(w);
    onCommit(w);
  };
  const max = getMax();
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.min(width, max)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={title}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize touch-none hover:bg-primary/40 active:bg-primary/60 focus-visible:bg-primary/60 focus-visible:outline-none z-10"
    />
  );
}

// elementConfirmText builds the confirm dialog copy for one element removal.
function elementConfirmText(ref: RedisElementRef, key: string, t: TFunction): { title: string; description: string } {
  const generic = (cmd: string) => t('elementDelete.description', {
    defaultValue: 'Runs {{cmd}} on "{{key}}". If it was the last element, Redis deletes the key too. This cannot be undone.',
    cmd,
    key,
  });
  switch (ref.type) {
    case 'hash':
      return { title: t('elementDelete.titleField', { defaultValue: 'Delete field "{{name}}"?', name: ref.field }), description: generic('HDEL') };
    case 'set':
      return { title: t('elementDelete.titleMember', { defaultValue: 'Delete member "{{name}}"?', name: ref.member }), description: generic('SREM') };
    case 'zset':
      return { title: t('elementDelete.titleMember', { defaultValue: 'Delete member "{{name}}"?', name: ref.member }), description: generic('ZREM') };
    case 'stream':
      return { title: t('elementDelete.titleEntry', { defaultValue: 'Delete entry {{name}}?', name: ref.entryId }), description: generic('XDEL') };
    case 'list':
      return {
        title: t('elementDelete.titleListItem', { defaultValue: 'Delete element #{{index}}?', index: ref.index }),
        description: t('elementDelete.listDescription', {
          defaultValue: 'Removes exactly this element from "{{key}}" — only if position {{index}} still holds the value shown; otherwise nothing changes. If it was the last element, Redis deletes the key too. This cannot be undone.',
          key,
          index: ref.index,
        }),
      };
  }
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="p-4 flex items-start gap-2 text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <pre className="whitespace-pre-wrap font-mono">{text}</pre>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

// splitArgs tokenizes a console command line, honoring single/double quotes.
function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inS = false, inD = false, has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inS) { if (ch === "'") inS = false; else cur += ch; }
    else if (inD) { if (ch === '"') inD = false; else cur += ch; }
    else if (ch === "'") { inS = true; has = true; }
    else if (ch === '"') { inD = true; has = true; }
    else if (/\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } }
    else { cur += ch; has = true; }
  }
  if (has) out.push(cur);
  return out;
}

function strBytes(v: ValueResult): Uint8Array {
  const s = v.string ?? '';
  if (v.valueEncoding === 'base64') {
    try {
      const bin = atob(s);
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return a;
    } catch { return new TextEncoder().encode(s); }
  }
  return new TextEncoder().encode(s);
}

function strUtf8(v: ValueResult): string {
  if (v.valueEncoding === 'base64') {
    try { return new TextDecoder().decode(strBytes(v)); } catch { return v.string ?? ''; }
  }
  return v.string ?? '';
}

function decodeStr(v: ValueResult, mode: DecodeMode): string {
  switch (mode) {
    case 'auto':
    case 'utf8':
      return strUtf8(v);
    case 'base64': {
      if (v.valueEncoding === 'base64') return v.string ?? '';
      let bin = '';
      strBytes(v).forEach((b) => { bin += String.fromCharCode(b); });
      try { return btoa(bin); } catch { return v.string ?? ''; }
    }
    case 'hex':
      return Array.from(strBytes(v)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    case 'json': {
      const s = strUtf8(v);
      try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
    }
    default:
      return strUtf8(v);
  }
}

function decodePayload(payload: string, encoding: string): string {
  if (encoding === 'base64') {
    try {
      const bin = atob(payload);
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(a);
    } catch { return payload; }
  }
  return payload;
}

// formatTTL renders a millisecond TTL: -1 → ∞ (no expiry), -2 → — (missing),
// otherwise a compact human duration.
function formatTTL(ttlMs: number): string {
  if (ttlMs === -1) return '∞';
  if (ttlMs === -2) return '—';
  const sec = Math.round(ttlMs / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function humanSize(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function renderReply(result?: CommandResult): string {
  if (!result) return '';
  const r = result.reply;
  if (r == null) return '(nil)';
  if (typeof r === 'string') return r;
  if (typeof r === 'number' || typeof r === 'boolean') return String(r);
  try { return JSON.stringify(r, null, 2); } catch { return String(r); }
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
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
