import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Search,
  FolderOpen,
  Clock,
  ClipboardCheck,
  Server,
  FileText,
  Database,
  Radio,
  Cloud,
  HardDrive,
  Boxes,
  Ship,
  GitBranch,
  NotebookText,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog';
import { searchAPI, notesAPI } from '@/services/api';
import { openNoteTab } from '@/components/notes/useOpenNote';
import type { NoteSearchHit } from '@/types';
import { isDesktop } from '@/lib/platform';
import { useRequestStore } from '@/stores/requestStore';
import { useSidebarStore } from '@/stores/sidebarStore';
import { useAuthStore } from '@/stores/authStore';
import { useCollectionStore } from '@/stores/collectionStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useDBConnectionStore } from '@/stores/dbConnectionStore';
import { useKafkaConnectionStore } from '@/stores/kafkaConnectionStore';
import { useS3ConnectionStore } from '@/stores/s3ConnectionStore';
import { useRedisConnectionStore } from '@/stores/redisConnectionStore';
import { useESConnectionStore } from '@/stores/esConnectionStore';
import { useK8sConnectionStore } from '@/stores/k8sConnectionStore';
import { useGitConnectionStore, scopeForGit } from '@/stores/gitConnectionStore';
import { cn } from '@/lib/utils';
import type { Collection, SavedRequest, SearchResult, Tab } from '@/types';

// ── Spotlight global search ─────────────────────────────────────────────
// Clicking the TopBar trigger opens a centered, focused modal (Apple-Spotlight
// feel): one prominent autofocused input, a row of scope pills, and grouped
// results below. It searches requests + collections (via the BE `searchAPI`
// in synced mode, or a client-side walk in local mode — same as before) AND
// every connection type (DB / Kafka / S3 / Redis / Elasticsearch / Kubernetes
// / Git) from the in-memory connection stores. Selecting a result opens the
// thing: a request opens its request tab, a collection reveals the sidebar,
// and a connection opens that tool's tab preselected to the connection.
//
// Cmd/Ctrl+K is intentionally left to CommandPalette — this component owns no
// global keyboard listener (it's rendered twice in the responsive TopBar).

type GroupId =
  | 'requests'
  | 'notes'
  | 'collections'
  | 'connections'
  | 'history'
  | 'environments'
  | 'testcases'
  | 'mock';

type ConnType = 'db' | 'kafka' | 's3' | 'redis' | 'es' | 'k8s' | 'git';

interface SpotResult {
  key: string;
  group: GroupId;
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  /** Small type badge (used for connection rows). */
  badge?: { label: string; cls: string };
  onOpen: () => void;
}

// Labels resolved at render via t('groups.<id>') / t('scopes.<id>') so the
// arrays stay module-level (label text lives in the search namespace JSON).
const GROUPS: { id: GroupId }[] = [
  { id: 'requests' },
  { id: 'notes' },
  { id: 'collections' },
  { id: 'connections' },
  { id: 'history' },
  { id: 'environments' },
  { id: 'testcases' },
  { id: 'mock' },
];

type ScopeId = 'all' | 'requests' | 'collections' | 'connections';
const SCOPES: { id: ScopeId }[] = [
  { id: 'all' },
  { id: 'requests' },
  { id: 'collections' },
  { id: 'connections' },
];

// Per-group cap so a long history can't bury connections.
const GROUP_CAP = 8;

const CONN_STYLE: Record<ConnType, { label: string; icon: React.ElementType; cls: string }> = {
  db: { label: 'DB', icon: Database, cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  kafka: { label: 'Kafka', icon: Radio, cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
  s3: { label: 'S3', icon: Cloud, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  redis: { label: 'Redis', icon: HardDrive, cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  es: { label: 'Elasticsearch', icon: Boxes, cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-400' },
  k8s: { label: 'Kubernetes', icon: Ship, cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  git: { label: 'Git', icon: GitBranch, cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
};

// Icon + destination-group mapping for the request/collection BE (or local)
// search results.
const SR_GROUP: Record<string, GroupId> = {
  request: 'requests',
  collection: 'collections',
  history: 'history',
  environment: 'environments',
  testcase: 'testcases',
  'test-case': 'testcases',
  'mock-server': 'mock',
};
const SR_ICON: Record<GroupId, React.ElementType> = {
  requests: FileText,
  notes: NotebookText,
  collections: FolderOpen,
  connections: Server,
  history: Clock,
  environments: Server,
  testcases: ClipboardCheck,
  mock: Server,
};

/** Client-side walk over collections/history/environments — used verbatim in
 *  local mode where there is no BE search endpoint. */
function localSearch(q: string, t: TFunction): SearchResult[] {
  const needle = q.toLowerCase();
  const results: SearchResult[] = [];

  const collections = useCollectionStore.getState().collections;
  const walk = (list: Collection[]) => {
    for (const col of list) {
      if (col.name.toLowerCase().includes(needle) || (col.description || '').toLowerCase().includes(needle)) {
        results.push({ type: 'collection', id: col.id, title: col.name, subtitle: col.description || '', matchedField: 'name' });
      }
      for (const req of (col.requests || []) as SavedRequest[]) {
        const hay = `${req.name} ${req.url} ${req.method}`.toLowerCase();
        if (hay.includes(needle)) {
          results.push({ type: 'request', id: req.id, title: req.name, subtitle: `${req.method} ${req.url}`, matchedField: 'name/url' });
        }
      }
      if (col.children) walk(col.children);
    }
  };
  walk(collections);

  const history = useHistoryStore.getState().items;
  for (const h of history) {
    const hay = `${h.method} ${h.url}`.toLowerCase();
    if (hay.includes(needle)) {
      results.push({ type: 'history', id: h.id, title: `${h.method} ${h.url}`, subtitle: `${h.statusCode} · ${t('durationMs', { n: h.duration })}`, matchedField: 'url' });
    }
  }

  const envs = useEnvironmentStore.getState().environments;
  for (const env of envs) {
    if (env.name.toLowerCase().includes(needle)) {
      const varCount = env.variables?.length || 0;
      results.push({ type: 'environment', id: env.id, title: env.name, subtitle: t(varCount === 1 ? 'variablesCountOne' : 'variablesCountOther', { n: varCount }), matchedField: 'name' });
    }
  }

  return results.slice(0, 60);
}

/** Find a saved request anywhere in the loaded collection tree, so a request
 *  result opens with its real method/url/headers/auth (not a stale stub). */
function findRequestById(id: string): { req: SavedRequest; baseUrl?: string } | null {
  const parseJson = <T,>(v: unknown, fallback: T): T => {
    if (Array.isArray(v) || (v && typeof v === 'object')) return (v as T) ?? fallback;
    if (typeof v === 'string') {
      try { return JSON.parse(v) as T; } catch { return fallback; }
    }
    return fallback;
  };
  const walk = (list: Collection[], baseUrl?: string): { req: SavedRequest; baseUrl?: string } | null => {
    for (const col of list) {
      const nextBase = (col as { baseUrl?: string }).baseUrl ?? baseUrl;
      for (const req of (col.requests || []) as SavedRequest[]) {
        if (req.id === id) {
          return {
            req: {
              ...req,
              headers: parseJson(req.headers, []),
              params: parseJson(req.params, []),
              body: parseJson(req.body, { type: 'none', content: '' }),
              auth: parseJson(req.auth, { type: 'none' }),
            } as SavedRequest,
            baseUrl: nextBase,
          };
        }
      }
      if (col.children) {
        const found = walk(col.children, nextBase);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(useCollectionStore.getState().collections);
}

// GlobalSearch is rendered twice (responsive TopBar). A single module-level
// owner handles the Cmd/Ctrl+P open shortcut so only one modal opens.
let searchShortcutOwnerClaimed = false;

export function GlobalSearch() {
  const { t } = useTranslation('search');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeId>('all');
  const [baseResults, setBaseResults] = useState<SearchResult[]>([]);
  const [noteHits, setNoteHits] = useState<NoteSearchHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const seqRef = useRef(0);

  const addTab = useRequestStore((s) => s.addTab);
  const setSidebarTab = useSidebarStore((s) => s.setActiveTab);
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const webLocal = isLocal && !isDesktop();

  // Reactive in-memory connection lists (already loaded by the sidebars; a
  // warm-up fetch below covers the case where none has been opened yet).
  const dbConns = useDBConnectionStore((s) => s.connections);
  const kafkaConns = useKafkaConnectionStore((s) => s.connections);
  const s3Conns = useS3ConnectionStore((s) => s.connections);
  const redisConns = useRedisConnectionStore((s) => s.connections);
  const esConns = useESConnectionStore((s) => s.connections);
  const k8sConns = useK8sConnectionStore((s) => s.connections);
  const gitConns = useGitConnectionStore((s) => s.connections);

  const close = useCallback(() => {
    setOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Open on the Cmd/Ctrl+P shortcut (dispatched by useKeyboardShortcuts).
  // Only the module-level owner instance listens (the modal portals to <body>,
  // so it shows regardless of which responsive trigger is visible).
  useEffect(() => {
    if (searchShortcutOwnerClaimed) return;
    searchShortcutOwnerClaimed = true;
    const onOpen = () => setOpen(true);
    window.addEventListener('patchman:open-search', onOpen);
    return () => {
      window.removeEventListener('patchman:open-search', onOpen);
      searchShortcutOwnerClaimed = false;
    };
  }, []);

  // Reset transient state + focus the input every time the modal opens, and
  // warm the connection stores that no sidebar has fetched yet (in-memory,
  // fire-and-forget; skipped in unauthenticated web-local so it can't trip an
  // auth interceptor).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setScope('all');
    setBaseResults([]);
    setSelectedIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    if (!webLocal) {
      const warm = (st: { getState: () => { connections: unknown[]; fetchConnections: () => Promise<void> } }) => {
        const s = st.getState();
        if (s.connections.length === 0) s.fetchConnections().catch(() => {});
      };
      warm(useDBConnectionStore);
      warm(useKafkaConnectionStore);
      warm(useS3ConnectionStore);
      warm(useRedisConnectionStore);
      warm(useESConnectionStore);
      warm(useK8sConnectionStore);
      warm(useGitConnectionStore);
    }
    return () => cancelAnimationFrame(raf);
  }, [open, webLocal]);

  // Debounced BE (synced) / client-walk (local) search for requests +
  // collections. A seq guard drops a slow earlier response that would
  // otherwise overwrite a newer query's results.
  const doSearch = useCallback(async (q: string) => {
    const seq = ++seqRef.current;
    if (!q.trim()) {
      setNoteHits([]);
      setBaseResults([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    // Notes have their own full-text endpoint (also on the desktop's embedded
    // backend); it runs alongside and fills the Notes group.
    notesAPI.search(q, GROUP_CAP)
      .then((res) => { if (seq === seqRef.current) setNoteHits((res.data as NoteSearchHit[]) ?? []); })
      .catch(() => { if (seq === seqRef.current) setNoteHits([]); });
    try {
      if (isLocal) {
        const data = localSearch(q, t);
        if (seq === seqRef.current) setBaseResults(data);
      } else {
        const response = await searchAPI.search(q);
        const body = response.data?.data || response.data;
        const data = Array.isArray(body?.results) ? body.results : Array.isArray(body) ? body : [];
        if (seq === seqRef.current) setBaseResults(data as SearchResult[]);
      }
    } catch {
      if (seq === seqRef.current) setBaseResults([]);
    }
    if (seq === seqRef.current) setIsLoading(false);
  }, [isLocal, t]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, doSearch]);

  // ── Navigation actions ────────────────────────────────────────────────
  // Mirror the collection tree's default open (RequestItem): NO forceNew, so
  // an already-open tab for this request is focused + refreshed instead of a
  // duplicate being appended (and "Save" still writes back to the collection).
  const openRequest = useCallback((id: string, title: string) => {
    const found = findRequestById(id);
    if (!found) {
      // BE hit not in the loaded tree — open a light stub keyed by requestId.
      // Omit method/url so it can't clobber an already-open tab for it.
      addTab({ name: title, requestId: id });
      return;
    }
    const { req, baseUrl } = found;
    // Prepend the collection baseUrl only for a relative saved path.
    let url = req.url || '';
    if (baseUrl && url.startsWith('/')) url = baseUrl.replace(/\/+$/, '') + url;
    // Split a leading scheme so the protocol selector + URL input stay in sync.
    let protocol: 'https://' | 'http://' | undefined;
    if (url.startsWith('https://')) { protocol = 'https://'; url = url.slice(8); }
    else if (url.startsWith('http://')) { protocol = 'http://'; url = url.slice(7); }
    addTab({
      name: req.name,
      method: req.method,
      url,
      ...(protocol ? { protocol } : {}),
      headers: req.headers,
      params: req.params,
      body: req.body,
      auth: req.auth,
      requestId: req.id,
    });
  }, [addTab]);

  const openConnTab = useCallback((tab: Partial<Tab>) => {
    addTab(tab, true);
  }, [addTab]);

  // Map a BE/local SearchResult to a grouped, navigable SpotResult.
  const toSpot = useCallback((sr: SearchResult): SpotResult | null => {
    const group = SR_GROUP[sr.type];
    if (!group) return null;
    let onOpen: () => void;
    switch (group) {
      case 'requests':
        onOpen = () => openRequest(sr.id, sr.title);
        break;
      case 'collections':
        onOpen = () => setSidebarTab('collections');
        break;
      case 'history':
        onOpen = () => setSidebarTab('history');
        break;
      case 'environments':
        onOpen = () => setSidebarTab('environments');
        break;
      case 'testcases':
        onOpen = () => setSidebarTab('qa');
        break;
      case 'mock':
        onOpen = () => setSidebarTab('mock');
        break;
      default:
        onOpen = () => {};
    }
    return {
      key: `${sr.type}-${sr.id}`,
      group,
      title: sr.title,
      subtitle: sr.subtitle,
      icon: SR_ICON[group],
      onOpen: () => { onOpen(); close(); },
    };
  }, [openRequest, setSidebarTab, close]);

  const baseSpot = useMemo(
    () => baseResults.map(toSpot).filter((r): r is SpotResult => r !== null),
    [baseResults, toSpot],
  );

  // ── Connections (in-memory, client-side filter) ───────────────────────
  const connSpot = useMemo<SpotResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SpotResult[] = [];
    const make = (type: ConnType, id: string, name: string, subtitle: string, tab: Partial<Tab>) => {
      const style = CONN_STYLE[type];
      out.push({
        key: `${type}-${id}`,
        group: 'connections',
        title: name,
        subtitle,
        icon: style.icon,
        badge: { label: style.label, cls: style.cls },
        onOpen: () => { openConnTab(tab); close(); },
      });
    };
    const match = (parts: (string | undefined)[]) =>
      parts.filter(Boolean).join(' ').toLowerCase().includes(q);

    for (const c of dbConns) {
      if (match([c.name, c.host, c.kind, c.database, c.username])) {
        make('db', c.id, c.name, `${c.kind} · ${c.host}`, {
          type: 'db', name: `${c.kind.toUpperCase()} · ${c.name}`, method: 'GET', url: '',
          dbConnectionId: c.id, dbQuery: '',
        });
      }
    }
    for (const c of kafkaConns) {
      if (match([c.name, c.bootstrapServers])) {
        make('kafka', c.id, c.name, c.bootstrapServers, {
          type: 'kafka', name: `Kafka · ${c.name}`, method: 'GET', url: '', kafkaConnectionId: c.id,
        });
      }
    }
    for (const c of s3Conns) {
      if (match([c.name, c.endpoint, c.region, c.provider])) {
        make('s3', c.id, c.name, c.endpoint || `${c.provider} · ${c.region}`, {
          type: 's3', name: `S3 · ${c.name}`, method: 'GET', url: '', s3ConnectionId: c.id, s3Prefix: '',
        });
      }
    }
    for (const c of redisConns) {
      if (match([c.name, c.address, c.mode])) {
        make('redis', c.id, c.name, c.address, {
          type: 'redis', name: `Redis · ${c.name}`, method: 'GET', url: '',
          redisConnectionId: c.id, redisDb: c.dbIndex ?? 0,
        });
      }
    }
    for (const c of esConns) {
      if (match([c.name, c.nodes])) {
        make('es', c.id, c.name, c.nodes, {
          type: 'es', name: `ES · ${c.name}`, method: 'GET', url: '', esConnectionId: c.id,
        });
      }
    }
    for (const c of k8sConns) {
      if (match([c.name, c.defaultContext])) {
        make('k8s', c.id, c.name, c.defaultContext, {
          type: 'k8s', name: `K8s · ${c.name}`, method: 'GET', url: '',
          k8sConnectionId: c.id, k8sContext: c.defaultContext,
        });
      }
    }
    for (const c of gitConns) {
      if (match([c.name, c.baseUrl, c.provider])) {
        make('git', c.id, c.name, c.baseUrl, {
          type: 'git', name: c.name, method: 'GET', url: '',
          gitConnectionId: c.id, gitScope: scopeForGit(gitConns, c.id),
        });
      }
    }
    return out;
  }, [query, dbConns, kafkaConns, s3Conns, redisConns, esConns, k8sConns, gitConns, openConnTab, close]);

  const noteSpot = useMemo<SpotResult[]>(() => noteHits.map((h) => ({
    key: `note-${h.id}`,
    group: 'notes',
    title: h.title,
    subtitle: [(h.breadcrumb ?? []).join(' / '), h.snippet].filter(Boolean).join(' — '),
    icon: NotebookText,
    onOpen: () => { openNoteTab(h.id, h.title); close(); },
  })), [noteHits, close]);

  const combined = useMemo(() => [...baseSpot, ...noteSpot, ...connSpot], [baseSpot, noteSpot, connSpot]);

  // Grouped + scope-filtered + capped, in the canonical group order.
  const grouped = useMemo(() => {
    const byGroup = new Map<GroupId, SpotResult[]>();
    for (const r of combined) {
      const arr = byGroup.get(r.group) ?? [];
      arr.push(r);
      byGroup.set(r.group, arr);
    }
    return GROUPS
      .filter((g) => scope === 'all' || scope === g.id)
      .map((g) => ({ ...g, items: (byGroup.get(g.id) ?? []).slice(0, GROUP_CAP) }))
      .filter((g) => g.items.length > 0);
  }, [combined, scope]);

  const flatList = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const counts = useMemo(() => {
    const c: Record<ScopeId, number> = { all: 0, requests: 0, collections: 0, connections: 0 };
    for (const r of combined) {
      c.all++;
      if (r.group === 'requests' || r.group === 'collections' || r.group === 'connections') c[r.group]++;
    }
    return c;
  }, [combined]);

  // Clamp selection whenever the visible list changes.
  useEffect(() => {
    setSelectedIndex((i) => (flatList.length === 0 ? 0 : Math.min(i, flatList.length - 1)));
  }, [flatList.length]);

  // Keep the selected row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatList.length) setSelectedIndex((i) => (i + 1) % flatList.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatList.length) setSelectedIndex((i) => (i - 1 + flatList.length) % flatList.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flatList[selectedIndex]?.onOpen();
    } else if (e.key === 'Tab') {
      // Cycle scope pills with Tab / Shift+Tab so the keyboard never leaves
      // the input.
      e.preventDefault();
      const idx = SCOPES.findIndex((s) => s.id === scope);
      const next = e.shiftKey
        ? (idx - 1 + SCOPES.length) % SCOPES.length
        : (idx + 1) % SCOPES.length;
      setScope(SCOPES[next].id);
      setSelectedIndex(0);
    }
    // Escape falls through to Radix, which closes the dialog.
  }, [flatList, selectedIndex, scope]);

  let runningIndex = 0;

  return (
    <>
      {/* TopBar trigger — looks like the old inline input, opens the modal. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/40 cursor-pointer"
        title={t('triggerTitle')}
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">{t('triggerText')}</span>
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogPortal>
          <DialogOverlay className="bg-black/60 backdrop-blur-sm" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onKeyDown={handleKeyDown}
            className={cn(
              'fixed left-[50%] top-[12%] z-50 grid w-full max-w-[640px] translate-x-[-50%] translate-y-0',
              'overflow-hidden rounded-xl border bg-background shadow-2xl duration-150',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%]',
            )}
          >
            <DialogTitle className="sr-only">{t('dialogTitle')}</DialogTitle>

            {/* Prominent search input */}
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
                placeholder={t('placeholder')}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
              />
              {isLoading && (
                <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              )}
              <kbd className="hidden shrink-0 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
                ESC
              </kbd>
            </div>

            {/* Scope pills — "şunların içinde ara" */}
            <div className="flex items-center gap-1 border-b px-3 py-2">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setScope(s.id); setSelectedIndex(0); }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                    scope === s.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t(`scopes.${s.id}`)}
                  <span
                    className={cn(
                      'rounded-full px-1 text-[10px] tabular-nums',
                      scope === s.id ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
                    )}
                  >
                    {counts[s.id]}
                  </span>
                </button>
              ))}
            </div>

            {/* Grouped results */}
            <div
              ref={listRef}
              className="max-h-[min(420px,55vh)] overflow-y-auto overflow-x-hidden overscroll-contain py-2"
            >
              {!query.trim() ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('idle.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {t('idle.hint')}
                  </p>
                </div>
              ) : flatList.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-muted-foreground">{t('noResults.title')}</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">{t('noResults.hint')}</p>
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.id} className="mb-1">
                    <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {t(`groups.${group.id}`)}
                    </div>
                    {group.items.map((item) => {
                      const idx = runningIndex++;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          data-index={idx}
                          onClick={() => item.onOpen()}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            'flex w-full items-start gap-2.5 px-4 py-2 text-left outline-none transition-colors duration-75 cursor-pointer',
                            idx === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50',
                          )}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium">{item.title}</span>
                              {item.badge && (
                                <span className={cn('shrink-0 rounded px-1 py-0 text-[9px] font-semibold', item.badge.cls)}>
                                  {item.badge.label}
                                </span>
                              )}
                            </div>
                            {item.subtitle && (
                              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.subtitle}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
