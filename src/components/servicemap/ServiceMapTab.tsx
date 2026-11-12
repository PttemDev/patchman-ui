import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Boxes, CheckCircle2, Crosshair, Filter, Loader2, Maximize2, Network, PenTool, RefreshCw, Search, Sparkles, Table2, Waypoints, X, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { serviceMapAPI } from '@/services/api';
import { useRequestStore } from '@/stores/requestStore';
import { useK8sConnectionStore, scopeForK8s } from '@/stores/k8sConnectionStore';
import { useObservabilityConnectionStore, scopeForObservability, observabilityError } from '@/stores/observabilityConnectionStore';
import { useWhiteboardStore } from '@/stores/whiteboardStore';
import { getBoardApi, insertMermaid } from '@/components/excalidraw/excalidrawInsert';
import { cn } from '@/lib/utils';
import type { ServiceMapGraph, Tab } from '@/types';
import { ServiceMapCanvas } from './ServiceMapCanvas';
import { ServiceMapDetail, type NodePlace } from './ServiceMapDetail';
import { ServiceMapTable } from './ServiceMapTable';
import { SourcePicker, type Sources } from './SourcePicker';
import { NamespacePicker } from './NamespacePicker';
import {
  filterGraph, fmtPct, fmtRps, groupByNamespace, matchesSearch, membersOf, namespacesOf, neighbourhood, scopeNamespaces, toMermaid, totals,
  DENSE_EDGES, DENSE_NODES, GROUP_AUTO, NODE_KINDS, type MapFilters,
} from './serviceMapUtil';
import type { ServiceMapGroup, ServiceMapNodeKind } from '@/types';
import type { MotionMode } from './particles';
import { noteText } from '@/components/observability/providers';
import './serviceMap.css';

const MOTION_KEY = 'patchman_sm_motion';
const FILTER_KEY = 'patchman_sm_filters';

function readMotion(): MotionMode {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === 'calm' || v === 'off' ? v : 'full';
  } catch {
    return 'full';
  }
}

function readFilters(): MapFilters {
  const base: MapFilters = { hideSystem: true, onlyErrors: false, hideIsolated: false, trafficOnly: false, hiddenKinds: [], search: '' };
  try {
    const v = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') as Partial<MapFilters>;
    return {
      ...base,
      hideSystem: v.hideSystem ?? true,
      hideIsolated: v.hideIsolated ?? false,
      trafficOnly: v.trafficOnly ?? false,
      hiddenKinds: Array.isArray(v.hiddenKinds) ? v.hiddenKinds.filter((k) => NODE_KINDS.includes(k)) : [],
    };
  } catch {
    return base;
  }
}

const NO_IDS = new Set<string>();

/** Keeps calls that vanished since the last refresh for one more round,
 *  marked "gone", so a disappearing link is noticed. */
function withGhosts(prev: ServiceMapGraph | null, next: ServiceMapGraph): ServiceMapGraph {
  if (!prev) return next;
  const ids = new Set(next.edges.map((e) => e.id));
  const nodes = new Set(next.nodes.map((n) => n.id));
  const ghosts = prev.edges
    .filter((e) => !ids.has(e.id) && !e.sources.includes('gone') && nodes.has(e.from) && nodes.has(e.to))
    .map((e) => ({ ...e, sources: ['gone'], stats: { rps: 0, errorRate: 0 }, evidence: [] }));
  return ghosts.length ? { ...next, edges: [...next.edges, ...ghosts] } : next;
}

export default function ServiceMapTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation('servicemap');
  const { toast } = useToast();
  const updateTab = useRequestStore((s) => s.updateTab);
  const active = useRequestStore((s) => s.activeTabId === tab.id);
  const k8sConns = useK8sConnectionStore((s) => s.connections);
  const fetchK8s = useK8sConnectionStore((s) => s.fetchConnections);
  const obsConns = useObservabilityConnectionStore((s) => s.connections);
  const fetchObs = useObservabilityConnectionStore((s) => s.fetchConnections);

  const [graph, setGraph] = useState<ServiceMapGraph | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [motion, setMotion] = useState<MotionMode>(readMotion);
  const [filters, setFilters] = useState<MapFilters>(readFilters);
  const [fitSignal, setFitSignal] = useState(0);
  /** Show only what lies within `depth` hops of one node. */
  const [focus, setFocus] = useState<{ id: string; depth: number } | null>(null);
  const prevRef = useRef<ServiceMapGraph | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selRef = useRef(false);
  selRef.current = !!(selectedNode || selectedEdge);

  useEffect(() => {
    if (k8sConns.length === 0) void fetchK8s();
    if (obsConns.length === 0) void fetchObs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasSources = !!tab.smK8sConnectionId || (tab.smApm?.length ?? 0) > 0;
  const execScope = useMemo(() => {
    if (tab.smExecScope) return tab.smExecScope;
    if (tab.smK8sConnectionId) return scopeForK8s(k8sConns, tab.smK8sConnectionId);
    const first = tab.smApm?.[0]?.split('@')[0];
    return first ? scopeForObservability(obsConns, first) : undefined;
  }, [tab.smExecScope, tab.smK8sConnectionId, tab.smApm, k8sConns, obsConns]);

  const load = useCallback(async (fresh = false) => {
    if (!hasSources) return;
    setLoading(true);
    setError('');
    try {
      const res = await serviceMapAPI.get({
        k8s: tab.smK8sConnectionId, context: tab.smK8sContext, namespaces: tab.smNamespaces, clusterProm: tab.smClusterProm,
        apm: tab.smApm, range: tab.smRange, fresh,
      }, execScope);
      // The axios interceptor unwraps the BE's { data } envelope.
      const g = res.data as ServiceMapGraph;
      if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error(t('error.title'));
      const prev = prevRef.current;
      if (prev) {
        const known = new Set(prev.nodes.map((n) => n.id));
        const fresh = g.nodes.filter((n) => !known.has(n.id)).map((n) => n.id);
        setNewIds(new Set(fresh));
        if (fresh.length) setTimeout(() => setNewIds(new Set()), 2600);
      }
      const merged = withGhosts(prev, g);
      prevRef.current = g;
      setGraph(merged);
      setGeneratedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(observabilityError(e).message);
    }
    setLoading(false);
  }, [hasSources, tab.smK8sConnectionId, tab.smK8sContext, tab.smNamespaces, tab.smClusterProm, tab.smApm, tab.smRange, execScope]);

  useEffect(() => {
    prevRef.current = null;
    setGraph(null);
    setFocus(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.smK8sConnectionId, tab.smK8sContext, (tab.smNamespaces ?? []).join(','), tab.smClusterProm, (tab.smApm ?? []).join(','), tab.smRange, execScope]);

  // Auto-refresh while the tab is in front (never faster than the BE cache).
  useEffect(() => {
    const secs = Number(tab.smRefresh || 0);
    if (!secs || !active || !hasSources) return;
    const h = setInterval(() => { if (!document.hidden) void load(); }, Math.max(30, secs) * 1000);
    return () => clearInterval(h);
  }, [tab.smRefresh, active, hasSources, load]);

  // Keyboard: / search, f fit, Esc clear, Space pause.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'f') setFitSignal((n) => n + 1);
      else if (e.key === 'Escape') {
        if (selRef.current) { setSelectedNode(null); setSelectedEdge(null); } else setFocus(null);
      }
      else if (e.key === ' ') { e.preventDefault(); setMotion((m) => (m === 'off' ? 'full' : 'off')); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => { try { localStorage.setItem(MOTION_KEY, motion); } catch { /* private mode */ } }, [motion]);
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({
        hideSystem: filters.hideSystem, hideIsolated: filters.hideIsolated, trafficOnly: filters.trafficOnly, hiddenKinds: filters.hiddenKinds,
      }));
    } catch { /* private mode */ }
  }, [filters.hideSystem, filters.hideIsolated, filters.trafficOnly, filters.hiddenKinds]);

  // View pipeline: namespace scope → filters → namespace folding → focus.
  const nsKey = (tab.smNsFilter ?? []).join('\n');
  const expandedKey = (tab.smExpanded ?? []).join('\n');
  const namespaces = useMemo(() => (graph ? namespacesOf(graph) : []), [graph]);
  const scoped = useMemo(() => (graph ? scopeNamespaces(graph, tab.smNsFilter) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, nsKey]);
  const filtered = useMemo(() => (scoped ? filterGraph(scoped.graph, filters) : null), [scoped, filters]);
  const groupMode = tab.smGroup ?? 'auto';
  const searching = !!filters.search.trim();
  const grouping = !!filtered && !searching && (groupMode === 'on' || (groupMode === 'auto' && filtered.nodes.length > GROUP_AUTO));
  const expanded = useMemo(() => new Set(tab.smExpanded ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedKey]);
  const grouped = useMemo(() => (filtered && grouping ? groupByNamespace(filtered, expanded, t('group.outside')) : filtered),
    [filtered, grouping, expanded, t]);
  const view = useMemo(() => {
    if (!grouped || !filtered || !focus) return grouped;
    const base = grouped.nodes.some((n) => n.id === focus.id) ? grouped : filtered;
    return neighbourhood(base, focus.id, focus.depth) ?? grouped;
  }, [grouped, filtered, focus]);
  const focusNode = focus ? (grouped?.nodes.find((n) => n.id === focus.id) ?? filtered?.nodes.find((n) => n.id === focus.id)) : undefined;
  // A focus whose node left the map (filters, refresh) ends.
  useEffect(() => {
    if (focus && filtered && grouped && !focusNode) setFocus(null);
  }, [focus, focusNode, filtered, grouped]);
  const context = useMemo(() => {
    const c = scoped?.context;
    if (!c?.size || !view || !filtered) return NO_IDS;
    const out = new Set<string>();
    for (const n of view.nodes) {
      if (n.group) {
        const ms = membersOf(filtered, n);
        if (ms.length && ms.every((m) => c.has(m.id))) out.add(n.id);
      } else if (c.has(n.id)) out.add(n.id);
    }
    return out;
  }, [scoped, view, filtered]);
  const dense = !!view && (view.nodes.length > DENSE_NODES || view.edges.length > DENSE_EDGES);
  const layoutKey = JSON.stringify([nsKey, grouping, expandedKey, focus, filters]);
  const groupCount = view?.nodes.filter((n) => n.group).length ?? 0;
  // The HUD counts real calls: folded links would undercount them.
  const hudGraph = focus ? view : filtered;
  const sum = useMemo(() => (hudGraph ? totals(hudGraph) : null), [hudGraph]);
  const labels = useMemo(() => ({
    health: { ok: t('health.ok'), warning: t('health.warning'), critical: t('health.critical'), unknown: t('health.unknown') },
    rps: t('card.rps'),
    noTraffic: t('card.noTraffic'),
    conn: t('card.conn'),
    group: (g: ServiceMapGroup) => [
      t('group.nodes', { count: g.members }),
      g.kinds.datastore ? t('group.datastores', { count: g.kinds.datastore }) : '',
      g.kinds.messaging ? t('group.messaging', { count: g.kinds.messaging }) : '',
    ].filter(Boolean).join(' · '),
    openGroup: t('group.open'),
  }), [t]);

  const setExpanded = (next: string[]) => {
    setSelectedNode(null);
    setSelectedEdge(null);
    updateTab(tab.id, { smExpanded: next });
  };
  const openGroup = (id: string) => {
    const g = grouped?.nodes.find((n) => n.id === id)?.group;
    if (!g) return;
    setFocus(null);
    setExpanded([...(tab.smExpanded ?? []).filter((x) => x !== g.namespace), g.namespace]);
  };
  const setNsFilter = (next: string[]) => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setFocus(null);
    updateTab(tab.id, { smNsFilter: next, smExpanded: [] });
  };
  const toggleGrouping = () => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setFocus(null);
    updateTab(tab.id, { smGroup: grouping ? 'off' : 'on', smExpanded: [] });
  };
  const focusSearch = () => {
    const q = filters.search.trim().toLowerCase();
    if (!q || !scoped) return;
    const hits = scoped.graph.nodes.filter((n) => matchesSearch(n, q));
    const hit = hits.find((n) => n.name.toLowerCase() === q) ?? hits[0];
    if (!hit) return;
    setFilters((f) => ({ ...f, search: '' }));
    setSelectedEdge(null);
    setSelectedNode(hit.id);
    setFocus({ id: hit.id, depth: 1 });
    searchRef.current?.blur();
  };
  const toggleKind = (k: ServiceMapNodeKind, show: boolean) =>
    setFilters((f) => ({ ...f, hiddenKinds: show ? f.hiddenKinds.filter((x) => x !== k) : [...f.hiddenKinds, k] }));
  const corootUrls = useMemo(() => (tab.smApm ?? [])
    .map((a) => obsConns.find((c) => c.id === a.split('@')[0]))
    .filter((c) => c?.provider === 'coroot')
    .map((c) => c!.url), [tab.smApm, obsConns]);

  const applySources = (s: Sources) => {
    setSelectedNode(null);
    setSelectedEdge(null);
    updateTab(tab.id, s);
  };

  const exportToWhiteboard = async () => {
    if (!view || view.nodes.length === 0) return;
    try {
      const board = await useWhiteboardStore.getState().createBoard(`${tab.name || t('title')} · ${new Date().toLocaleDateString()}`);
      useRequestStore.getState().addTab({ type: 'excalidraw', whiteboardId: board.id, name: board.name, method: 'GET', url: '' }, true);
      const mermaid = toMermaid(view);
      const started = Date.now();
      const wait = () => {
        if (getBoardApi(board.id)) {
          void insertMermaid(board.id, mermaid).catch((e) => toast({ title: t('export.failed'), description: String(e), variant: 'destructive' }));
        } else if (Date.now() - started < 15_000) setTimeout(wait, 200);
        else toast({ title: t('export.failed'), variant: 'destructive' });
      };
      wait();
      if (view.nodes.length > 120) toast({ title: t('export.capped', { count: 120 }) });
    } catch (e) {
      toast({ title: t('export.failed'), description: observabilityError(e).message, variant: 'destructive' });
    }
  };

  const sourceSummary = [
    tab.smK8sConnectionId ? (k8sConns.find((c) => c.id === tab.smK8sConnectionId)?.name ?? 'K8s') : null,
    ...(tab.smApm ?? []).map((a) => obsConns.find((c) => c.id === a.split('@')[0])?.name ?? '…'),
  ].filter(Boolean).join(' + ');

  // The panel can also show a node or call that the filters hide (reached
  // from another node's call list), so fall back to the unfiltered graph.
  const node = view?.nodes.find((n) => n.id === selectedNode) ?? graph?.nodes.find((n) => n.id === selectedNode);
  const edge = view?.edges.find((e) => e.id === selectedEdge) ?? graph?.edges.find((e) => e.id === selectedEdge);
  const placeOf = useMemo(() => {
    const shown = new Set(view?.nodes.map((n) => n.id));
    const kept = new Set(filtered?.nodes.map((n) => n.id));
    const groups = new Map((view?.nodes ?? []).filter((n) => n.group).map((n) => [n.group!.namespace, n.name]));
    return (id: string): NodePlace => {
      if (shown.has(id)) return { state: 'shown' };
      const n = graph?.nodes.find((x) => x.id === id);
      const g = n ? groups.get(n.namespace ?? '') : undefined;
      if (kept.has(id) && g) return { state: 'folded', group: g };
      return { state: 'hidden' };
    };
  }, [view, filtered, graph]);
  const isTable = tab.smView === 'table';

  return (
    <div className="sm-root flex-1 min-h-0 flex flex-col" data-motion={motion === 'off' ? 'off' : 'on'} data-dense={dense}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Waypoints className="h-4 w-4 text-[var(--sm-accent)]" />
        <span className="text-sm font-semibold mr-1">{t('title')}</span>
        <SourcePicker tab={tab} onApply={applySources}>
          <Button variant="outline" size="sm" className="h-7 max-w-[320px] text-xs">
            <Network className="h-3.5 w-3.5 mr-1.5 shrink-0" /><span className="truncate">{sourceSummary || t('sources.pick')}</span>
          </Button>
        </SourcePicker>
        <Select value={tab.smRange || '15m'} onValueChange={(v) => updateTab(tab.id, { smRange: v })}>
          <SelectTrigger className="h-7 w-[92px] text-xs" aria-label={t('toolbar.range')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {['5m', '15m', '1h', '6h', '24h'].map((r) => <SelectItem key={r} value={r}>{t(`range.${r}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tab.smRefresh || '0'} onValueChange={(v) => updateTab(tab.id, { smRefresh: v === '0' ? '' : v })}>
          <SelectTrigger className="h-7 w-[112px] text-xs" aria-label={t('toolbar.refresh')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t('refresh.off')}</SelectItem>
            <SelectItem value="30">{t('refresh.s30')}</SelectItem>
            <SelectItem value="60">{t('refresh.m1')}</SelectItem>
            <SelectItem value="300">{t('refresh.m5')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load(true)} disabled={loading || !hasSources} title={t('toolbar.reload')}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input ref={searchRef} value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusSearch(); } }}
            placeholder={t('toolbar.search')} title={t('toolbar.searchHint')} className="h-7 w-44 pl-7 text-xs" />
        </div>
        {focus && focusNode && (
          <span className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/50 bg-primary/5 pl-2 text-xs text-primary">
            <Crosshair className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate" title={focusNode.namespace ? `${focusNode.namespace}/${focusNode.name}` : focusNode.name}>{focusNode.name}</span>
            {[1, 2, 3].map((d) => (
              <button key={d} type="button" onClick={() => setFocus({ ...focus, depth: d })} title={t('detail.focusHops', { count: d })}
                className={cn('h-5 w-5 rounded font-mono text-[11px]', focus.depth === d ? 'bg-primary/15' : 'hover:bg-primary/10')}>
                {d}
              </button>
            ))}
            <button type="button" onClick={() => setFocus(null)} className="flex h-7 w-6 items-center justify-center hover:bg-primary/10" aria-label={t('focus.clear')} title={t('focus.clear')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        {graph && namespaces.length > 1 && (
          <NamespacePicker namespaces={namespaces} selected={tab.smNsFilter ?? []} onChange={setNsFilter} />
        )}
        {graph && (
          <Button variant="ghost" size="sm" className={cn('h-7 text-xs', grouping && 'text-primary bg-primary/10')}
            onClick={toggleGrouping} disabled={searching} title={t('toolbar.groupHint', { count: GROUP_AUTO })} aria-pressed={grouping}>
            <Boxes className="h-3.5 w-3.5 mr-1" /> {t('toolbar.group')}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={cn('h-7 text-xs', (filters.onlyErrors || filters.hideIsolated || filters.trafficOnly || filters.hiddenKinds.length > 0) && 'text-primary')}>
              <Filter className="h-3.5 w-3.5 mr-1" /> {t('toolbar.filters')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuCheckboxItem checked={filters.hideSystem} onCheckedChange={(v) => setFilters((f) => ({ ...f, hideSystem: !!v }))}>{t('filters.hideSystem')}</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={filters.onlyErrors} onCheckedChange={(v) => setFilters((f) => ({ ...f, onlyErrors: !!v }))}>{t('filters.onlyErrors')}</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={filters.hideIsolated} onCheckedChange={(v) => setFilters((f) => ({ ...f, hideIsolated: !!v }))}>{t('filters.hideIsolated')}</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={filters.trafficOnly} onCheckedChange={(v) => setFilters((f) => ({ ...f, trafficOnly: !!v }))}>{t('filters.trafficOnly')}</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px]">{t('filters.show')}</DropdownMenuLabel>
            {NODE_KINDS.map((k) => (
              <DropdownMenuCheckboxItem key={k} checked={!filters.hiddenKinds.includes(k)} onCheckedChange={(v) => toggleKind(k, !!v)} onSelect={(e) => e.preventDefault()}>
                {t(`kind.${k}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs" title={t('toolbar.motion')}>
              <Sparkles className={cn('h-3.5 w-3.5 mr-1', motion === 'off' && 'opacity-40')} /> {t(`motion.${motion}`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[11px]">{t('toolbar.motion')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(['full', 'calm', 'off'] as const).map((m) => (
              <DropdownMenuCheckboxItem key={m} checked={motion === m} onCheckedChange={() => setMotion(m)}>{t(`motion.${m}`)}</DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex rounded-md border overflow-hidden" role="group" aria-label={t('toolbar.view')}>
          <button type="button" onClick={() => updateTab(tab.id, { smView: 'map' })} className={cn('px-2 h-7 text-xs flex items-center gap-1', !isTable ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50')}>
            <Waypoints className="h-3.5 w-3.5" /> {t('toolbar.map')}
          </button>
          <button type="button" onClick={() => updateTab(tab.id, { smView: 'table' })} className={cn('px-2 h-7 text-xs flex items-center gap-1 border-l', isTable ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50')}>
            <Table2 className="h-3.5 w-3.5" /> {t('toolbar.table')}
          </button>
        </div>
        {!isTable && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFitSignal((n) => n + 1)} title={t('toolbar.fit')}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={exportToWhiteboard} disabled={!view?.nodes.length} title={t('toolbar.export')}>
          <PenTool className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* HUD: live totals + per-source status */}
      {graph && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5 text-[11px]">
          <Hud label={t('hud.rps')} value={sum && sum.observed > 0 ? fmtRps(sum.rps) : '—'} />
          <Hud label={t('hud.errors')} value={sum && sum.observed > 0 ? fmtPct(sum.errorRate) : '—'}
            tone={sum && sum.errorRate >= 0.05 ? 'var(--sm-crit)' : sum && sum.errorRate >= 0.01 ? 'var(--sm-warn)' : undefined} />
          <Hud label={t('hud.services')} value={String(hudGraph?.nodes.length ?? 0)} />
          {grouping && groupCount > 0 && !focus && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Boxes className="h-3 w-3" />{t('hud.grouped', { count: groupCount })}
            </span>
          )}
          <Hud label={t('hud.calls')} value={`${sum?.observed ?? 0}/${hudGraph?.edges.length ?? 0}`} title={t('hud.callsHint')} />
          {generatedAt && <span className="text-muted-foreground">{t('hud.updated', { time: generatedAt })}</span>}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {Object.entries(graph.sources).map(([key, st]) => {
              const name = key.startsWith('apm:') ? (obsConns.find((c) => c.id === key.slice(4))?.name ?? key) : t(`sourceName.${key}`, { defaultValue: key });
              const notes = (st.notes ?? []).map((n) => noteText(t, n)).join(' · ');
              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', st.ok ? 'text-foreground' : 'text-destructive border-destructive/40')}>
                      {st.ok ? <CheckCircle2 className="h-3 w-3 text-[var(--sm-ok)]" /> : <XCircle className="h-3 w-3" />}
                      {name}
                      {st.ok && (st.notes?.length ?? 0) > 0 && <AlertTriangle className="h-3 w-3 text-[var(--sm-warn)]" />}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{st.error || notes || t('hud.sourceOk')}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {!hasSources ? (
          <Empty icon={<Waypoints className="h-10 w-10" />} title={t('empty.title')} text={t('empty.text')}>
            <SourcePicker tab={tab} onApply={applySources}><Button size="sm">{t('sources.pick')}</Button></SourcePicker>
          </Empty>
        ) : !graph && loading ? (
          <Empty icon={<Loader2 className="h-8 w-8 animate-spin" />} title={t('loading.title')} text={t('loading.text')} />
        ) : !graph && error ? (
          <Empty icon={<AlertTriangle className="h-8 w-8 text-destructive" />} title={t('error.title')} text={error}>
            <Button size="sm" variant="outline" onClick={() => void load(true)}>{t('common:retry')}</Button>
          </Empty>
        ) : view && view.nodes.length === 0 ? (
          <Empty icon={<Waypoints className="h-10 w-10" />} title={t('emptyGraph.title')} text={t('emptyGraph.text')} />
        ) : view && filtered && isTable ? (
          <ServiceMapTable graph={focus ? view : filtered} selectedEdge={selectedEdge} onSelectEdge={(id) => { setSelectedNode(null); setSelectedEdge(id); }} />
        ) : view ? (
          <ServiceMapCanvas
            graph={view}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            onSelectNode={setSelectedNode}
            onSelectEdge={setSelectedEdge}
            newIds={newIds}
            motion={motion}
            active={active}
            labels={labels}
            fitSignal={fitSignal}
            dense={dense}
            context={context}
            layoutKey={layoutKey}
            onOpenGroup={openGroup}
          />
        ) : null}
        {error && graph && (
          <div className="absolute left-3 top-3 z-10 rounded-md bg-destructive/90 px-2 py-1 text-[11px] text-white">{error}</div>
        )}
        {view && (node || edge) && (
          <ServiceMapDetail
            graph={view}
            full={graph ?? view}
            placeOf={placeOf}
            node={node}
            edge={edge}
            tab={tab}
            corootUrls={corootUrls}
            onSelectNode={(id) => { setSelectedEdge(null); setSelectedNode(id); }}
            onSelectEdge={(id) => { setSelectedNode(null); setSelectedEdge(id); }}
            onClose={() => { setSelectedNode(null); setSelectedEdge(null); }}
            members={node?.group && filtered ? membersOf(filtered, node) : undefined}
            onOpenMember={(id) => {
              if (node?.group) setExpanded([...(tab.smExpanded ?? []).filter((x) => x !== node.group!.namespace), node.group.namespace]);
              setFocus(null);
              setSelectedNode(id);
            }}
            onExpand={node?.group ? () => openGroup(node.id) : undefined}
            onCollapse={grouping && node && !node.group && expanded.has(node.namespace ?? '')
              ? () => setExpanded((tab.smExpanded ?? []).filter((x) => x !== (node.namespace ?? '')))
              : undefined}
            onFocus={(depth) => node && setFocus({ id: node.id, depth })}
            focusDepth={focus && node && focus.id === node.id ? focus.depth : undefined}
            onOnlyNamespace={(ns) => setNsFilter([ns])}
          />
        )}
      </div>
    </div>
  );
}

function Hud({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold tabular-nums" style={{ color: tone }}>{value}</span>
    </span>
  );
}

function Empty({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="sm-stage absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-muted-foreground/60">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      <p className="max-w-md text-xs text-muted-foreground break-words">{text}</p>
      {children}
    </div>
  );
}
