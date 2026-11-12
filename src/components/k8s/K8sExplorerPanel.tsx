import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EntityNotes } from '@/components/notes/EntityNotes';
import { k8sUri } from '@/lib/entityUri';
import { useTranslation } from 'react-i18next';
import { openServiceMap } from '@/components/servicemap/openServiceMap';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CodeEditor } from '@/components/ui/CodeEditor';
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  X,
  Server,
  Boxes,
  Bell,
  Box,
  Layers,
  Database,
  LayoutGrid,
  Briefcase,
  Clock,
  Network,
  FileText,
  KeyRound,
  Globe,
  FileCode2,
  ScrollText,
  ListTree,
  Radio,
  MoreVertical,
  Pencil,
  Trash2,
  RotateCcw,
  Gauge,
  TerminalSquare,
  Play,
  Ban,
  CheckCircle2,
  Droplets,
  Check,
  ArrowRightLeft,
  Cable,
  Copy,
  LayoutDashboard,
  Activity,
  ChevronRight,
  ChevronDown,
  History,
  ArrowLeft, Waypoints,
} from 'lucide-react';
import { k8sAPI, type DBScope, type K8sAccessCheck, type K8sPortForward } from '@/services/api';
import { useK8sConnectionStore, scopeForK8s } from '@/stores/k8sConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import { ExecScopePicker } from '@/components/common/ExecScopePicker';
import { K8sIcon } from '@/components/icons/K8sIcon';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { K8sTerminal } from '@/components/k8s/K8sTerminal';
import { PodMetricsChart } from '@/components/k8s/PodMetricsChart';
import { K8sOverview } from '@/components/k8s/K8sOverview';
import { K8sApplyDialog } from '@/components/k8s/K8sApplyDialog';
import { PodLogsTab } from '@/components/k8s/PodLogsTab';
import { useSafeConfirm } from '@/components/k8s/safeConfirm';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/platform';
import type { Tab, ResourceRow, ResourceDetail, ClusterVersion, K8sPodMetrics, K8sPodMetricsResult, K8sWorkloadRelated } from '@/types';

interface K8sExplorerPanelProps {
  tab: Tab;
}

// Sentinel Select value for "all namespaces" — shadcn Select forbids an
// empty-string item value, so we map this token to '' at the API boundary.
const ALL_NS = '__all__';

type KindId =
  | 'nodes' | 'namespaces' | 'events'
  | 'pods' | 'deployments' | 'statefulsets' | 'daemonsets' | 'jobs' | 'cronjobs'
  | 'services' | 'configmaps' | 'secrets' | 'ingresses';

// Cluster-scoped kinds ignore the namespace filter (events are namespaced but
// listed cluster-wide here, OpenLens-style).
const CLUSTER_KINDS = new Set<KindId>(['nodes', 'namespaces', 'events']);

interface KindDef {
  id: KindId;
  labelKey: string;
  icon: typeof Server;
}

// Left kind-nav, grouped Cluster vs Namespaced (order per the v1 spec).
// labelKey values are resolved with t() at render; the kind names stay English
// (Kubernetes resource kinds) per the glossary.
const KIND_GROUPS: { labelKey: string; kinds: KindDef[] }[] = [
  {
    labelKey: 'kinds.groupCluster',
    kinds: [
      { id: 'nodes', labelKey: 'kinds.nodes', icon: Server },
      { id: 'namespaces', labelKey: 'kinds.namespaces', icon: Boxes },
      { id: 'events', labelKey: 'kinds.events', icon: Bell },
    ],
  },
  {
    labelKey: 'kinds.groupNamespaced',
    kinds: [
      { id: 'pods', labelKey: 'kinds.pods', icon: Box },
      { id: 'deployments', labelKey: 'kinds.deployments', icon: Layers },
      { id: 'statefulsets', labelKey: 'kinds.statefulsets', icon: Database },
      { id: 'daemonsets', labelKey: 'kinds.daemonsets', icon: LayoutGrid },
      { id: 'jobs', labelKey: 'kinds.jobs', icon: Briefcase },
      { id: 'cronjobs', labelKey: 'kinds.cronjobs', icon: Clock },
      { id: 'services', labelKey: 'kinds.services', icon: Network },
      { id: 'configmaps', labelKey: 'kinds.configmaps', icon: FileText },
      { id: 'secrets', labelKey: 'kinds.secrets', icon: KeyRound },
      { id: 'ingresses', labelKey: 'kinds.ingresses', icon: Globe },
    ],
  },
];

const ALL_KINDS: KindDef[] = KIND_GROUPS.flatMap((g) => g.kinds);
// Returns the i18n key for a kind's plural label (resolve with t() at the call site).
const kindLabelKey = (id: string) => ALL_KINDS.find((k) => k.id === id)?.labelKey ?? 'kinds.pods';

// Which fixed ResourceRow fields each kind renders (dynamic `extra` columns
// are appended after these). `restarts`/`node` only make sense for pods.
type FixedCol = 'name' | 'ready' | 'status' | 'cpu' | 'memory' | 'restarts' | 'node' | 'age';
const KIND_COLUMNS: Record<KindId, FixedCol[]> = {
  pods: ['name', 'ready', 'status', 'cpu', 'memory', 'restarts', 'node', 'age'],
  deployments: ['name', 'ready', 'status', 'age'],
  statefulsets: ['name', 'ready', 'status', 'age'],
  daemonsets: ['name', 'ready', 'status', 'age'],
  jobs: ['name', 'ready', 'status', 'age'],
  cronjobs: ['name', 'status', 'age'],
  services: ['name', 'status', 'age'],
  configmaps: ['name', 'age'],
  secrets: ['name', 'age'],
  ingresses: ['name', 'age'],
  nodes: ['name', 'status', 'age'],
  namespaces: ['name', 'status', 'age'],
  events: ['name', 'age'],
};

// Fixed column → i18n key (resolved with t() at render). Name/Status reuse the
// shared common namespace; CPU/Node stay English per the glossary.
const FIXED_LABEL_KEYS: Record<FixedCol, string> = {
  name: 'common:name',
  ready: 'col.ready',
  status: 'common:status',
  cpu: 'col.cpu',
  memory: 'col.memory',
  restarts: 'col.restarts',
  node: 'col.node',
  age: 'col.age',
};

// kubectl-top-style memory formatting: binary (Ki/Mi/Gi) with a compact
// significand, matching the units the metrics-server reports.
function formatMemKube(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes}`;
  const units = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s.replace(/\.?0+$/, '')}${units[i]}`;
}

type DetailTab = 'overview' | 'yaml' | 'describe' | 'logs' | 'terminal' | 'metrics' | 'events' | 'pods' | 'revisions';

// Workload kinds whose drawer lists matched pods; the subset with rollout history.
const POD_OWNER_KINDS = new Set<KindId>(['deployments', 'statefulsets', 'daemonsets', 'jobs']);
const REVISION_KINDS = new Set<KindId>(['deployments', 'statefulsets', 'daemonsets']);

// ── Quick actions (v2 write/exec) ────────────────────────────────────────────
type ActionId =
  | 'exec' | 'logs' | 'edit' | 'delete'
  | 'restart' | 'scale'
  | 'cordon' | 'uncordon' | 'drain'
  | 'trigger' | 'portForward';

interface ActionMeta {
  labelKey: string;
  icon: typeof Server;
  // write ops require the connection's write grant AND an RBAC allow; reads
  // (logs) are gated by neither here.
  write: boolean;
  destructive?: boolean;
  // localOnly ops (port-forward) bind a listener on the user's machine — the
  // embedded BE 403s otherwise. Gated desktop-local, like the local shell.
  localOnly?: boolean;
}

// labelKey resolved with t() in ActionsMenu; kubectl verbs (cordon/drain/exec)
// stay English per the glossary. Delete reuses the shared common namespace.
const ACTION_META: Record<ActionId, ActionMeta> = {
  exec: { labelKey: 'actions.exec', icon: TerminalSquare, write: true },
  logs: { labelKey: 'actions.logs', icon: Radio, write: false },
  edit: { labelKey: 'actions.edit', icon: Pencil, write: true },
  delete: { labelKey: 'common:delete', icon: Trash2, write: true, destructive: true },
  restart: { labelKey: 'actions.restart', icon: RotateCcw, write: true },
  scale: { labelKey: 'actions.scale', icon: Gauge, write: true },
  cordon: { labelKey: 'actions.cordon', icon: Ban, write: true },
  uncordon: { labelKey: 'actions.uncordon', icon: CheckCircle2, write: true },
  drain: { labelKey: 'actions.drain', icon: Droplets, write: true, destructive: true },
  trigger: { labelKey: 'actions.trigger', icon: Play, write: true },
  portForward: { labelKey: 'actions.portForward', icon: ArrowRightLeft, write: true, localOnly: true },
};

// The kubectl-style resource group per kind (used for RBAC checks + apply).
function kindGroup(kind: KindId): string {
  switch (kind) {
    case 'deployments':
    case 'statefulsets':
    case 'daemonsets':
      return 'apps';
    case 'jobs':
    case 'cronjobs':
      return 'batch';
    case 'ingresses':
      return 'networking.k8s.io';
    default:
      return '';
  }
}

// A node is cordoned when kubectl reports "…,SchedulingDisabled" in its status.
function isCordoned(row: ResourceRow): boolean {
  return (row.status ?? '').toLowerCase().includes('schedulingdisabled');
}

// Which quick actions a kind exposes (order matters — most-used first). Nodes
// swap cordon⇄uncordon based on current state. Every kind also gets Edit +
// Delete (the "any" catalog).
function visibleActionIds(kind: KindId, cordoned: boolean): ActionId[] {
  switch (kind) {
    case 'pods':
      return ['exec', 'logs', 'portForward', 'edit', 'delete'];
    case 'services':
      return ['portForward', 'edit', 'delete'];
    case 'deployments':
    case 'statefulsets':
    case 'daemonsets':
      return ['restart', 'scale', 'edit', 'delete'];
    case 'cronjobs':
      return ['trigger', 'edit', 'delete'];
    case 'nodes':
      return [cordoned ? 'uncordon' : 'cordon', 'drain', 'edit', 'delete'];
    default:
      return ['edit', 'delete'];
  }
}

// The RBAC preflight checks for a kind — one per action id that maps to a
// distinct verb/resource. Positionally consumed by canI. Subresources use the
// kubectl "resource/subresource" slash convention (pods/exec, deploy/scale).
function actionChecks(kind: KindId, namespace: string): { id: ActionId; check: K8sAccessCheck }[] {
  const group = kindGroup(kind);
  const resource = kind; // our kind ids ARE the plural resource names
  const ns = CLUSTER_KINDS.has(kind) ? undefined : (namespace || undefined);
  const list: { id: ActionId; check: K8sAccessCheck }[] = [
    { id: 'edit', check: { verb: 'patch', group, resource, namespace: ns } },
    { id: 'delete', check: { verb: 'delete', group, resource, namespace: ns } },
  ];
  if (kind === 'pods') {
    list.push({ id: 'exec', check: { verb: 'create', resource: 'pods/exec', namespace: ns } });
  }
  if (kind === 'deployments' || kind === 'statefulsets' || kind === 'daemonsets') {
    list.push({ id: 'restart', check: { verb: 'patch', group: 'apps', resource, namespace: ns } });
    list.push({ id: 'scale', check: { verb: 'patch', group: 'apps', resource: `${resource}/scale`, namespace: ns } });
  }
  if (kind === 'cronjobs') {
    list.push({ id: 'trigger', check: { verb: 'create', group: 'batch', resource: 'jobs', namespace: ns } });
  }
  if (kind === 'nodes') {
    list.push({ id: 'cordon', check: { verb: 'patch', group: '', resource: 'nodes' } });
    list.push({ id: 'uncordon', check: { verb: 'patch', group: '', resource: 'nodes' } });
    list.push({ id: 'drain', check: { verb: 'create', resource: 'pods/eviction' } });
  }
  return list;
}

// Desired replica count parsed from a "ready/desired" cell (e.g. "3/5" → 5),
// used to seed the Scale dialog. Falls back to 1.
function currentReplicas(row: ResourceRow): number {
  const parts = (row.ready ?? '').split('/');
  const n = parseInt(parts[1] ?? parts[0] ?? '', 10);
  return Number.isFinite(n) ? n : 1;
}

// Container names from a pod spec (main + init) — drives the exec/logs selects.
function podContainers(obj: Record<string, unknown> | null): string[] {
  const spec = (obj?.spec ?? {}) as Record<string, unknown>;
  const main = Array.isArray(spec.containers) ? spec.containers : [];
  const init = Array.isArray(spec.initContainers) ? spec.initContainers : [];
  return [...main, ...init]
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).name : undefined))
    .filter((n): n is string => typeof n === 'string');
}

// K8sExplorerPanel is the Kubernetes tab body — an OpenLens-style read
// explorer: a connection/context/namespace toolbar, a left kind nav, a center
// resource table, and a right detail drawer (Overview / YAML / Describe /
// Logs / Events). v1 is READ ONLY — no exec/edit/delete/scale. Matches the
// design language of RedisKeyPanel / ESConsolePanel.
export function K8sExplorerPanel({ tab }: K8sExplorerPanelProps) {
  const { t } = useTranslation('k8s');
  const connections = useK8sConnectionStore((s) => s.connections);
  const fetchConnections = useK8sConnectionStore((s) => s.fetchConnections);
  const updateTab = useRequestStore((s) => s.updateTab);
  const { theme } = useThemeStore();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useSafeConfirm();

  const connId = tab.k8sConnectionId ?? '';
  const conn = useMemo(() => connections.find((c) => c.id === connId) ?? null, [connections, connId]);
  const context = tab.k8sContext ?? conn?.defaultContext ?? '';
  const namespace = tab.k8sNamespace ?? '';
  const kind = (tab.k8sKind as KindId) ?? 'pods';
  const isClusterKind = CLUSTER_KINDS.has(kind);

  // Left-nav view: the Lens-style cluster dashboard vs the resource table.
  // Defaults to the Overview when a fresh tab has no kind picked yet; an
  // explicit 'overview' selection always wins, and picking a resource kind
  // (which stamps k8sView:'resources') keeps the table. Existing tabs that
  // already had a kind selected stay on their table (the `!tab.k8sKind` guard).
  const showOverview = tab.k8sView === 'overview' || (tab.k8sView == null && !tab.k8sKind);

  // Effective execution scope: per-tab override → connection home → derived.
  const scope: DBScope = tab.k8sExecScope
    ?? conn?.scope
    ?? (connId ? scopeForK8s(connections, connId) : 'remote');

  // Coarse write gate from the connection grant: owner / write can mutate; a
  // shared read-only grant cannot (BE enforces the same, 403). Own (unshared)
  // connections have no grantRole and are fully writable. Fine-grained RBAC
  // (canI) narrows this further per action below.
  const hasWriteGrant = !conn?.shared || conn?.grantRole === 'write' || conn?.grantRole === 'owner';

  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  // ── Cluster reachability / version ──────────────────────────────────
  const [version, setVersion] = useState<ClusterVersion | null>(null);
  const [versionErr, setVersionErr] = useState('');
  useEffect(() => {
    setVersion(null);
    setVersionErr('');
    if (!connId || !context) return;
    let cancelled = false;
    k8sAPI.version(connId, context, scope)
      .then((res) => { if (!cancelled) setVersion(res.data as ClusterVersion); })
      .catch((err) => { if (!cancelled) setVersionErr(extractErr(err, t('explorer.clusterUnreachable'))); });
    return () => { cancelled = true; };
  }, [connId, context, scope, t]);

  // ── Namespace list ──────────────────────────────────────────────────
  const [nsList, setNsList] = useState<string[]>([]);
  useEffect(() => {
    if (!connId || !context) { setNsList([]); return; }
    let cancelled = false;
    k8sAPI.resources(connId, { context, kind: 'namespaces' }, scope)
      .then((res) => {
        if (cancelled) return;
        const rows = (res.data as ResourceRow[]) ?? [];
        setNsList(rows.map((r) => r.name));
      })
      .catch(() => { if (!cancelled) setNsList([]); });
    return () => { cancelled = true; };
  }, [connId, context, scope]);

  // ── Resource table ──────────────────────────────────────────────────
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState('');
  const [filter, setFilter] = useState('');
  // ── Live watch (SSE) ────────────────────────────────────────────────
  // `live` is the user toggle (default on). `watchActive` is true only while
  // an SSE watch stream is actually open (drives the green "live" dot).
  // `watchNonce` is bumped to force a reopen (BE `reconnect` hint, server-side
  // close, or an error-fallback retry). The last synced resourceVersion is
  // kept for reference/debugging.
  const [live, setLive] = useState(true);
  const [watchActive, setWatchActive] = useState(false);
  const [watchNonce, setWatchNonce] = useState(0);
  const resourceVersionRef = useRef('');

  // ── Pod metrics (metrics-server, kubectl-top style) ─────────────────
  // Live CPU/mem usage joined onto the pod rows by `${namespace}/${name}`.
  // Fetched on view + manual refresh only (no polling) — it has its OWN effect
  // because with Live ON the watch owns `rows` and loadResources never runs.
  // `metricsHint` is a non-empty string when usage is unavailable (metrics-server
  // absent) or errored — the table shows it as an install hint instead of blanks.
  const [podMetrics, setPodMetrics] = useState<Map<string, K8sPodMetrics>>(new Map());
  const [metricsHint, setMetricsHint] = useState('');
  // Monotonic request id — a slower earlier fetch (e.g. a since-changed
  // namespace) is discarded so it can't overwrite the current view's metrics.
  const metricsReqRef = useRef(0);

  const loadPodMetrics = useCallback(async () => {
    const reqId = ++metricsReqRef.current;
    if (!connId || !context || kind !== 'pods') {
      setPodMetrics(new Map());
      setMetricsHint('');
      return;
    }
    try {
      const params: { context: string; namespace?: string } = { context };
      if (namespace) params.namespace = namespace;
      const res = await k8sAPI.podMetrics(connId, params, scope);
      if (reqId !== metricsReqRef.current) return; // superseded by a newer fetch
      const r = res.data as K8sPodMetricsResult;
      if (!r?.available) {
        setPodMetrics(new Map());
        setMetricsHint(r?.reason || t('explorer.metricsNeedServer'));
        return;
      }
      const m = new Map<string, K8sPodMetrics>();
      for (const p of r.pods ?? []) m.set(`${p.namespace}/${p.name}`, p);
      setPodMetrics(m);
      setMetricsHint('');
    } catch (err) {
      if (reqId !== metricsReqRef.current) return;
      setPodMetrics(new Map());
      setMetricsHint(extractErr(err, t('explorer.metricsUnavailable')));
    }
  }, [connId, context, namespace, kind, scope, t]);

  const loadResources = useCallback(async () => {
    if (!connId || !context) { setRows([]); return; }
    setRowsLoading(true);
    setRowsError('');
    try {
      const params: { context: string; namespace?: string; kind: string } = { context, kind };
      if (!CLUSTER_KINDS.has(kind) && namespace) params.namespace = namespace;
      const res = await k8sAPI.resources(connId, params, scope);
      setRows((res.data as ResourceRow[]) ?? []);
    } catch (err) {
      setRowsError(extractErr(err, t('explorer.listResourcesFailed')));
      setRows([]);
    } finally {
      setRowsLoading(false);
    }
  }, [connId, context, namespace, kind, scope, t]);

  // Poll (one-shot list) only when Live is OFF — the watch below owns the rows
  // while live, and its error path falls back to this same loader. Skipped
  // entirely while the Overview dashboard is showing (no table to fill).
  useEffect(() => {
    if (showOverview || live) return;
    loadResources();
  }, [loadResources, live, showOverview]);

  // Fetch pod metrics on view + on context/namespace/kind/scope change (NOT on
  // every watch event — `rows` is deliberately absent from the deps). Cleanly
  // clears when leaving the Pods kind or the Overview owns the view.
  useEffect(() => {
    if (showOverview || kind !== 'pods') {
      setPodMetrics(new Map());
      setMetricsHint('');
      return;
    }
    loadPodMetrics();
  }, [loadPodMetrics, showOverview, kind]);

  // ── Live watch stream ───────────────────────────────────────────────
  // One SSE watch per selected (connection, context, namespace, kind).
  // Reuses the logs streaming-fetch+reader consumer. On `sync` we replace the
  // rows + store the resourceVersion; `added`/`modified` upsert by
  // namespace/name; `deleted` removes; `reconnect` (BE watch cap) reopens.
  // Any error/close falls back to a one-shot poll and retries the watch. The
  // AbortController tears the stream down on kind/namespace/context/connection/
  // scope change, when Live is switched off, and on unmount.
  useEffect(() => {
    // No live watch while the Overview dashboard owns the view — it has its
    // own snapshot fetch and there's no table to stream into. Also clear a
    // pending rowsLoading so the toolbar Refresh doesn't stay disabled if the
    // user flips to Overview mid-connect.
    if (showOverview) { setWatchActive(false); setRowsLoading(false); return; }
    if (!live) { setWatchActive(false); return; }
    if (!connId || !context) { setRows([]); setWatchActive(false); return; }
    const ac = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    setRowsError('');
    setRowsLoading(true);
    (async () => {
      try {
        const wparams: { context: string; namespace?: string; kind: string } = { context, kind };
        if (!CLUSTER_KINDS.has(kind) && namespace) wparams.namespace = namespace;
        const { url } = k8sAPI.watchUrl(connId, wparams, scope);
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok || !res.body) throw new Error(`watch HTTP ${res.status}`);
        setWatchActive(true);
        setRowsLoading(false);
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
            const { event, data } = parseSseFrame(frame);
            if (!event) continue;
            if (event === 'reconnect') {
              // BE capped the watch — reopen cleanly with a fresh nonce.
              ac.abort();
              setWatchNonce((n) => n + 1);
              return;
            }
            if (!data) continue;
            let payload: unknown;
            try { payload = JSON.parse(data); } catch { continue; }
            if (event === 'sync') {
              const p = payload as { rows?: ResourceRow[]; resourceVersion?: string };
              resourceVersionRef.current = p.resourceVersion ?? '';
              setRows(p.rows ?? []);
              setRowsError('');
            } else if (event === 'added' || event === 'modified') {
              const r = payload as ResourceRow;
              setRows((prev) => {
                const i = prev.findIndex((x) => x.name === r.name && x.namespace === r.namespace);
                if (i === -1) return [...prev, r];
                const next = prev.slice();
                next[i] = r;
                return next;
              });
            } else if (event === 'deleted') {
              const r = payload as ResourceRow;
              setRows((prev) => prev.filter((x) => !(x.name === r.name && x.namespace === r.namespace)));
            }
          }
        }
        // Stream closed by the server without a reconnect hint — reopen shortly.
        if (!ac.signal.aborted) {
          setWatchActive(false);
          retry = setTimeout(() => setWatchNonce((n) => n + 1), 3000);
        }
      } catch (e) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        // Watch unreachable/errored — fall back to a one-shot poll, then retry
        // the watch (this is the polling fallback the spec asks for).
        setWatchActive(false);
        setRowsLoading(false);
        loadResources();
        retry = setTimeout(() => setWatchNonce((n) => n + 1), 5000);
      }
    })();
    return () => { ac.abort(); if (retry) clearTimeout(retry); };
  }, [connId, context, namespace, kind, scope, live, watchNonce, loadResources, showOverview]);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleConn = useCallback((v: string) => {
    const next = connections.find((c) => c.id === v) ?? null;
    updateTab(tab.id, { k8sConnectionId: v, k8sContext: next?.defaultContext ?? '', k8sNamespace: '' });
    setSelected(null);
  }, [connections, tab.id, updateTab]);

  const handleContext = useCallback((v: string) => {
    updateTab(tab.id, { k8sContext: v, k8sNamespace: '' });
    setSelected(null);
  }, [tab.id, updateTab]);

  const handleNamespace = useCallback((v: string) => {
    updateTab(tab.id, { k8sNamespace: v === ALL_NS ? '' : v });
    setSelected(null);
  }, [tab.id, updateTab]);

  const handleKind = useCallback((k: KindId) => {
    updateTab(tab.id, { k8sKind: k, k8sView: 'resources' });
    setSelected(null);
  }, [tab.id, updateTab]);

  const handleOverview = useCallback(() => {
    updateTab(tab.id, { k8sView: 'overview' });
    setSelected(null);
  }, [tab.id, updateTab]);

  // ── Detail drawer ───────────────────────────────────────────────────
  const [selected, setSelected] = useState<ResourceRow | null>(null);
  // A pod opened from a workload's Pods tab: the drawer shows it with kind
  // 'pods' (the table still lists the workload kind) and can step back.
  const [selectedKind, setSelectedKind] = useState<KindId | null>(null);
  const [drawerBack, setDrawerBack] = useState<{ row: ResourceRow; tab: DetailTab } | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // YAML edit → apply state, lifted so a row/header "Edit" action can flip the
  // drawer straight into edit mode.
  const [editingYaml, setEditingYaml] = useState(false);
  const [editedYaml, setEditedYaml] = useState('');
  // Non-null → the K8sApplyDialog is open with this YAML pending apply.
  const [applyYaml, setApplyYaml] = useState<string | null>(null);
  // Non-null → the Scale dialog target.
  const [scaleTarget, setScaleTarget] = useState<{ row: ResourceRow; replicas: number } | null>(null);
  // K8s v3 local kubeconfig terminal — a shell on the user's own machine. Only
  // possible on the desktop app against a local-scope connection (the embedded
  // BE 403s otherwise, and a hosted BE would spawn a shell on the server).
  const canLocalShell = isDesktop() && scope === 'local';
  const [showLocalShell, setShowLocalShell] = useState(false);
  // ── Side-panel widths (session-persisted) + a shared left-edge resize drag.
  // The local shell and the resource detail drawer are flex SIBLINGS of the
  // resource table (not absolute overlays), so each reserves real layout width
  // and PUSHES the table narrower (it scrolls horizontally) instead of covering
  // it. Drag a panel's left edge to resize; clamp to [360, maxFraction·vw].
  const [shellWidth, setShellWidth] = useState(640);
  const [detailWidth, setDetailWidth] = useState(560);
  const startLeftResize = useCallback(
    (e: React.MouseEvent, startWidth: number, setWidth: (n: number) => void, maxFraction: number) => {
      e.preventDefault();
      const startX = e.clientX;
      const move = (ev: MouseEvent) => {
        const max = window.innerWidth * maxFraction;
        // Panel is anchored right → dragging left (smaller clientX) widens it.
        const next = Math.min(Math.max(startWidth + (startX - ev.clientX), 360), max);
        setWidth(next);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    [],
  );
  // Never leave the shell drawer open after switching to a non-local target.
  useEffect(() => { if (!canLocalShell) setShowLocalShell(false); }, [canLocalShell]);
  // Rebuild the shell (new WS) when the connection/context changes.
  useEffect(() => { setShowLocalShell(false); }, [connId, context]);

  // ── K8s v3 port-forward ─────────────────────────────────────────────
  // Same desktop-local gate as the shell (the embedded BE binds the listener;
  // a hosted BE 403s). `pfTarget` drives the start Dialog; `pfList` backs the
  // active-forwards popover with a count badge.
  const canPortForward = canLocalShell;
  const [pfTarget, setPfTarget] = useState<ResourceRow | null>(null);
  const [pfListOpen, setPfListOpen] = useState(false);
  const [pfList, setPfList] = useState<K8sPortForward[]>([]);

  const refreshPfList = useCallback(async () => {
    if (!connId || !canPortForward) { setPfList([]); return; }
    try {
      const res = await k8sAPI.portForward.list(connId, scope);
      setPfList((res.data as K8sPortForward[]) ?? []);
    } catch {
      // Best-effort — a listing error just leaves the last known set.
    }
  }, [connId, canPortForward, scope]);

  // Keep the badge fresh on mount/scope change, and poll every 2s while the
  // popover is open (forwards are stateful — the BE owns their lifetime).
  useEffect(() => {
    if (!connId || !canPortForward) { setPfList([]); setPfListOpen(false); return; }
    refreshPfList();
    if (!pfListOpen) return;
    const t = setInterval(refreshPfList, 2000);
    return () => clearInterval(t);
  }, [connId, canPortForward, pfListOpen, refreshPfList]);

  const startedPf = useCallback((pf: K8sPortForward) => {
    setPfTarget(null);
    toast({
      title: t('portForward.started'),
      description: t('portForward.startedDesc', { name: pf.name, address: pf.address }),
      duration: 8000,
      action: (
        <ToastAction
          altText={t('portForward.copyAddress')}
          onClick={() => { navigator.clipboard.writeText(pf.address).catch(() => { /* ignore */ }); }}
        >
          <Copy className="h-3.5 w-3.5" />
        </ToastAction>
      ),
    });
    refreshPfList();
  }, [toast, refreshPfList, t]);

  const stopPf = useCallback(async (pf: K8sPortForward) => {
    try {
      await k8sAPI.portForward.stop(connId, pf.id, scope);
      toast({ title: t('portForward.stopped'), description: t('portForward.stoppedDesc', { name: pf.name, port: pf.localPort }) });
      refreshPfList();
    } catch (err) {
      toast({ title: t('portForward.stopFailed'), description: extractErr(err, t('actions.requestFailed')), variant: 'destructive' });
    }
  }, [connId, scope, toast, refreshPfList, t]);

  const openRow = useCallback(async (
    row: ResourceRow,
    initialTab: DetailTab = 'overview',
    edit = false,
    related?: { kind: KindId; back: { row: ResourceRow; tab: DetailTab } },
  ) => {
    // Detail + local shell are siblings that both push the table; opening one
    // closes the other so the table is never squeezed by both at once.
    setShowLocalShell(false);
    setSelected(row);
    setSelectedKind(related?.kind ?? null);
    setDrawerBack(related?.back ?? null);
    setDetailTab(initialTab);
    setEditingYaml(edit);
    setEditedYaml('');
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const params: { context: string; namespace?: string; kind: string; name: string } = {
        context, kind: related?.kind ?? kind, name: row.name,
      };
      if (row.namespace) params.namespace = row.namespace;
      const res = await k8sAPI.resource(connId, params, scope);
      setDetail(res.data as ResourceDetail);
    } catch (err) {
      setDetailError(extractErr(err, t('explorer.loadObjectFailed')));
    } finally {
      setDetailLoading(false);
    }
  }, [connId, context, kind, scope, t]);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setSelectedKind(null);
    setDrawerBack(null);
    setDetail(null);
    setEditingYaml(false);
    setEditedYaml('');
  }, []);

  // Seed the editor draft from the live YAML the first time edit mode opens.
  useEffect(() => {
    if (editingYaml && !editedYaml && detail?.yaml) setEditedYaml(detail.yaml);
  }, [editingYaml, editedYaml, detail?.yaml]);

  // ── RBAC preflight (canI) — gate the write UI, cached per target ──────
  const [rbac, setRbac] = useState<Record<string, boolean>>({});
  const rbacCache = useRef<Map<string, Record<string, boolean>>>(new Map());
  useEffect(() => {
    if (showOverview) { setRbac({}); return; }
    if (!connId || !context) { setRbac({}); return; }
    const nsKey = CLUSTER_KINDS.has(kind) ? '' : namespace;
    const key = `${connId}|${context}|${nsKey}|${kind}|${scope}`;
    const cached = rbacCache.current.get(key);
    if (cached) { setRbac(cached); return; }
    const checks = actionChecks(kind, namespace);
    let cancelled = false;
    k8sAPI.canI(connId, { context, checks: checks.map((c) => c.check) }, scope)
      .then((res) => {
        if (cancelled) return;
        const results = res.data?.results ?? [];
        const rec: Record<string, boolean> = {};
        checks.forEach((c, i) => { rec[c.id] = results[i] ?? false; });
        rbacCache.current.set(key, rec);
        setRbac(rec);
      })
      // On preflight failure leave the record empty → default-allow; the BE
      // still enforces the grant + RBAC on the actual write.
      .catch(() => { if (!cancelled) setRbac({}); });
    return () => { cancelled = true; };
  }, [connId, context, namespace, kind, scope, showOverview]);

  // ── Quick-action runner (confirm → api → toast → refresh) ────────────
  const runAction = useCallback(async (id: ActionId, row: ResourceRow) => {
    const ns = row.namespace || undefined;
    const name = row.name;
    const singular = singularKind(kind);
    // Read/drawer-routing actions don't hit the network here.
    if (id === 'exec') { openRow(row, 'terminal'); return; }
    if (id === 'logs') { openRow(row, 'logs'); return; }
    if (id === 'edit') { openRow(row, 'yaml', true); return; }
    if (id === 'scale') { setScaleTarget({ row, replicas: currentReplicas(row) }); return; }
    if (id === 'portForward') { setPfTarget(row); return; }
    const target = `${ns ? `${ns}/` : ''}${name}`;
    try {
      switch (id) {
        case 'delete': {
          const ok = await confirm({
            title: t('actions.deleteTitle', { kind: singular }),
            destructive: true,
            confirmLabel: t('common:delete'),
            typeToConfirm: name,
            description: t('actions.deleteDescription', { kind: singular, target }),
          });
          if (!ok) return;
          await k8sAPI.deleteResource(connId, { context, kind, namespace: ns, name }, scope);
          toast({ title: t('actions.deleted'), description: t('actions.deletedDesc', { kind: singular, name }) });
          if (selected?.name === name && selected?.namespace === row.namespace) closeDetail();
          loadResources();
          return;
        }
        case 'restart': {
          const ok = await confirm({
            title: t('actions.restartTitle'),
            confirmLabel: t('actions.restartConfirm'),
            description: t('actions.restartDescription', { kind: singular, name }),
          });
          if (!ok) return;
          await k8sAPI.rolloutRestart(connId, { context, kind, namespace: ns, name, stamp: new Date().toISOString() }, scope);
          toast({ title: t('actions.rolloutRestarted'), description: name });
          loadResources();
          return;
        }
        case 'cordon':
        case 'uncordon': {
          const on = id === 'cordon';
          const ok = await confirm({
            title: on ? t('actions.cordonTitle') : t('actions.uncordonTitle'),
            confirmLabel: on ? t('actions.cordonConfirm') : t('actions.uncordonConfirm'),
            description: on
              ? t('actions.cordonDescription', { name })
              : t('actions.uncordonDescription', { name }),
          });
          if (!ok) return;
          await k8sAPI.cordon(connId, { context, node: name, on }, scope);
          toast({ title: on ? t('actions.nodeCordoned') : t('actions.nodeUncordoned'), description: name });
          loadResources();
          return;
        }
        case 'drain': {
          const ok = await confirm({
            title: t('actions.drainTitle'),
            destructive: true,
            confirmLabel: t('actions.drainConfirm'),
            typeToConfirm: name,
            description: t('actions.drainDescription', { name }),
          });
          if (!ok) return;
          const res = await k8sAPI.drain(connId, { context, node: name }, scope);
          const evicted = res.data?.evicted?.length ?? 0;
          toast({
            title: t('actions.nodeDraining'),
            description: t(evicted === 1 ? 'actions.nodeDrainingDescOne' : 'actions.nodeDrainingDescOther', { name, count: evicted }),
          });
          loadResources();
          return;
        }
        case 'trigger': {
          const ok = await confirm({
            title: t('actions.triggerTitle'),
            confirmLabel: t('actions.triggerConfirm'),
            description: t('actions.triggerDescription', { name }),
          });
          if (!ok) return;
          await k8sAPI.cronjobTrigger(connId, { context, namespace: ns, name, stamp: new Date().toISOString() }, scope);
          toast({ title: t('actions.cronjobTriggered'), description: name });
          loadResources();
          return;
        }
      }
    } catch (err) {
      toast({ title: t('actions.actionFailed'), description: extractErr(err, t('actions.requestFailed')), variant: 'destructive' });
    }
  }, [connId, context, kind, scope, selected, confirm, toast, openRow, closeDetail, loadResources, t]);

  // Commit a scale from the Scale dialog (scale-to-0 is type-to-confirm gated).
  const applyScale = useCallback(async () => {
    if (!scaleTarget) return;
    const { row, replicas } = scaleTarget;
    if (replicas === 0) {
      const ok = await confirm({
        title: t('scale.toZeroTitle'),
        destructive: true,
        confirmLabel: t('scale.toZeroConfirm'),
        typeToConfirm: row.name,
        description: t('scale.toZeroDescription', { name: row.name }),
      });
      if (!ok) return;
    }
    try {
      await k8sAPI.scale(connId, { context, kind, namespace: row.namespace || undefined, name: row.name, replicas }, scope);
      toast({ title: t('scale.scaled'), description: t('scale.scaledDesc', { name: row.name, replicas }) });
      setScaleTarget(null);
      loadResources();
    } catch (err) {
      toast({ title: t('scale.scaleFailed'), description: extractErr(err, t('actions.requestFailed')), variant: 'destructive' });
    }
  }, [scaleTarget, connId, context, kind, scope, confirm, toast, loadResources, t]);

  const columns = useMemo(() => {
    const fixed = (KIND_COLUMNS[kind] ?? ['name', 'age']).map((id) => ({ id, label: t(FIXED_LABEL_KEYS[id]) }));
    // Union of extra keys across the rows, in first-seen order.
    const extraKeys: string[] = [];
    for (const r of rows) {
      if (!r.extra) continue;
      for (const k of Object.keys(r.extra)) if (!extraKeys.includes(k)) extraKeys.push(k);
    }
    return [
      ...fixed,
      ...extraKeys.map((k) => ({ id: `extra:${k}`, label: titleize(k) })),
    ];
  }, [kind, rows, t]);

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    // Also the kind's own columns: a NodePort (30080), a cluster / external
    // IP, an image, a node.
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q)
      || Object.values(r.extra ?? {}).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, filter]);
  // Cap the rendered rows: an all-namespaces view can return thousands of
  // resources and painting them all (each row carries an actions menu) locks
  // up the panel. Show a bounded slice + a hint to filter; the filter above
  // narrows the full set, so any resource is still reachable.
  const MAX_TABLE_ROWS = 500;
  const cappedRows = visibleRows.length > MAX_TABLE_ROWS ? visibleRows.slice(0, MAX_TABLE_ROWS) : visibleRows;

  const contexts = conn?.contexts ?? [];

  // Why the Namespace select is greyed out (native tooltip on the trigger) —
  // so a user viewing Nodes / the Overview understands the disabled control.
  const nsDisabledReason = showOverview
    ? t('explorer.nsDisabledOverview')
    : isClusterKind
      ? t('explorer.nsDisabledClusterScoped')
      : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
          <K8sIcon className="h-4 w-4 text-blue-500 shrink-0" />
          <Select value={connId} onValueChange={handleConn}>
            <SelectTrigger className="w-[220px] h-9 text-sm">
              <SelectValue placeholder={t('explorer.selectCluster')} />
            </SelectTrigger>
            <SelectContent>
              {connections.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {t('explorer.noClusters')}
                </div>
              ) : (
                connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.shared && <span className="ml-2 text-[10px] text-muted-foreground">· {c.grantRole ?? 'read'}</span>}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <Select value={context} onValueChange={handleContext} disabled={!connId || contexts.length === 0}>
            <SelectTrigger className="w-[190px] h-9 text-sm">
              <SelectValue placeholder={t('explorer.contextPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {contexts.map((ctx) => (
                <SelectItem key={ctx.name} value={ctx.name}>
                  <span className="truncate">{ctx.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={namespace || ALL_NS}
            onValueChange={handleNamespace}
            disabled={!connId || isClusterKind || showOverview}
          >
            {/* Span carries the title too — a disabled trigger can swallow the
                native tooltip, so the wrapper guarantees it shows on hover. */}
            <span title={nsDisabledReason} className="inline-flex">
              <SelectTrigger className="w-[180px] h-9 text-sm" title={nsDisabledReason}>
                <SelectValue placeholder={t('explorer.namespacePlaceholder')} />
              </SelectTrigger>
            </span>
            <SelectContent>
              <SelectItem value={ALL_NS}>{t('explorer.allNamespaces')}</SelectItem>
              {nsList.map((ns) => (
                <SelectItem key={ns} value={ns}>{ns}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {version ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn('inline-block h-2 w-2 rounded-full', version.reachable ? 'bg-emerald-500' : 'bg-destructive')} />
              <span className="font-mono text-foreground/80">{version.version}</span>
              {version.platform && <span>· {version.platform}</span>}
            </span>
          ) : versionErr ? (
            <span className="flex items-center gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {versionErr}
            </span>
          ) : null}

          {connId && (
            <ExecScopePicker
              scope={scope}
              availableScopes={conn?.availableScopes ?? (conn?.scope ? [conn.scope] : undefined)}
              onChange={(s) => updateTab(tab.id, { k8sExecScope: s })}
              noun="read"
            />
          )}

          {isDesktop() && connId && context && (
            <Button
              size="sm"
              variant={showLocalShell ? 'secondary' : 'ghost'}
              className="gap-1.5 h-9"
              disabled={!canLocalShell}
              title={canLocalShell
                ? t('explorer.localShellTitle')
                : t('explorer.localShellTitleDesktopOnly')}
              onClick={() => {
                // Opening the shell closes the detail drawer so the table isn't
                // squeezed by both — but never discard an unsaved YAML edit.
                if (!showLocalShell && !editingYaml) closeDetail();
                setShowLocalShell(!showLocalShell);
              }}
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              <span className="text-xs">{t('explorer.localShell')}</span>
            </Button>
          )}

          {/* Active port-forwards — desktop-local only. Count badge on the
              trigger; the popover lists each forward with Copy + Stop and
              polls while open. */}
          {isDesktop() && connId && context && (
            <Popover open={pfListOpen} onOpenChange={(o) => { if (canPortForward) setPfListOpen(o); }}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={pfListOpen ? 'secondary' : 'ghost'}
                  className="gap-1.5 h-9"
                  disabled={!canPortForward}
                  title={canPortForward
                    ? t('explorer.forwardsTitle')
                    : t('explorer.forwardsTitleDesktopOnly')}
                >
                  <Cable className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('explorer.forwards')}</span>
                  {pfList.length > 0 && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 tabular-nums">
                      {pfList.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="px-3 py-2 border-b flex items-center gap-2">
                  <Cable className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs font-medium">{t('explorer.activePortForwards')}</span>
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 tabular-nums ml-auto">
                    {pfList.length}
                  </Badge>
                </div>
                {pfList.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t('explorer.noActiveForwards')}
                  </div>
                ) : (
                  <ul className="max-h-72 overflow-auto divide-y">
                    {pfList.map((pf) => (
                      <li key={pf.id} className="px-3 py-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono truncate" title={pf.name}>{pf.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {pf.namespace ? `${pf.namespace} · ` : ''}
                            <span className="font-mono text-foreground/80">127.0.0.1:{pf.localPort}</span>
                            <span className="text-muted-foreground"> → {pf.targetPort}</span>
                          </div>
                        </div>
                        <CopyButton value={pf.address} />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                          title={t('explorer.stop')}
                          onClick={() => stopPf(pf)}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          )}

          {/* Live watch toggle — a real-time SSE watch replaces polling when on.
              The green pulsing dot shows only while the stream is actually open. */}
          <div className="flex items-center gap-1.5 h-9 pl-1 pr-0.5">
            {live && watchActive ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {t('explorer.liveActive')}
              </span>
            ) : (
              <Label className="text-[11px] text-muted-foreground select-none">{t('explorer.liveLabel')}</Label>
            )}
            <Switch checked={live} onCheckedChange={setLive} disabled={!connId} title={t('explorer.liveTitle')} />
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-9"
            disabled={!connId || rowsLoading}
            onClick={() => { loadResources(); loadPodMetrics(); }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', rowsLoading && 'animate-spin')} />
            <span className="text-xs">{t('common:refresh')}</span>
          </Button>
        </div>
      </div>

      {/* Body: kind nav + table + detail drawer */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left kind nav */}
        <nav className="w-48 shrink-0 border-r overflow-y-auto py-2">
          {/* Overview — the Lens-style cluster dashboard, pinned above the
              kind groups. Default view for a freshly selected cluster+context. */}
          <div className="mb-2">
            <button
              type="button"
              onClick={handleOverview}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                showOverview
                  ? 'bg-accent text-foreground font-medium border-l-2 border-blue-500'
                  : 'text-muted-foreground hover:bg-accent/40 border-l-2 border-transparent',
              )}
            >
              <LayoutDashboard className={cn('h-3.5 w-3.5 shrink-0', showOverview && 'text-blue-500')} />
              <span className="truncate">{t('explorer.overview')}</span>
            </button>
            {/* The live service map opens in its own tab. */}
            <button
              type="button"
              onClick={() => openServiceMap({
                title: `${t('explorer.serviceMap')} · ${conn?.name ?? ''}`,
                k8s: connId,
                context,
                namespaces: namespace ? [namespace] : [],
                execScope: scope,
              })}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors text-muted-foreground hover:bg-accent/40 border-l-2 border-transparent"
            >
              <Waypoints className="h-3.5 w-3.5 shrink-0 text-violet-500" />
              <span className="truncate">{t('explorer.serviceMap')}</span>
            </button>
          </div>
          {KIND_GROUPS.map((group) => (
            <div key={group.labelKey} className="mb-2">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(group.labelKey)}
              </div>
              {group.kinds.map((k) => {
                const Icon = k.icon;
                const active = !showOverview && kind === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => handleKind(k.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      active
                        ? 'bg-accent text-foreground font-medium border-l-2 border-blue-500'
                        : 'text-muted-foreground hover:bg-accent/40 border-l-2 border-transparent',
                    )}
                  >
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', active && 'text-blue-500')} />
                    <span className="truncate">{t(k.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Overview dashboard OR resource table + drawer */}
        <div className="flex-1 min-h-0 relative flex overflow-hidden">
          {showOverview ? (
            <K8sOverview connId={connId} context={context} connName={conn?.name ?? ''} scope={scope} />
          ) : (
          <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            {/* Table sub-toolbar */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
              <span className="text-xs font-medium">{t(kindLabelKey(kind))}</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{rows.length}</Badge>
              <div className="flex-1" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('explorer.filterByName')}
                className="h-7 w-[200px] text-xs"
              />
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {!connId ? (
                <CenterHint icon={<K8sIcon className="h-8 w-8 text-muted-foreground/40" />} text={t('explorer.selectClusterExplore')} />
              ) : rowsError ? (
                <ErrorBlock text={rowsError} />
              ) : rowsLoading && rows.length === 0 ? (
                <CenterHint icon={<Loader2 className="h-4 w-4 animate-spin" />} text={t('common:loading')} />
              ) : visibleRows.length === 0 ? (
                <CenterHint text={rows.length === 0 ? t('explorer.noResourcesFound', { kind: t(kindLabelKey(kind)).toLowerCase() }) : t('explorer.noFilterMatches')} />
              ) : (
                <>
                {kind === 'pods' && metricsHint && (
                  <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
                    <Gauge className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={metricsHint}>{metricsHint}</span>
                  </div>
                )}
                {visibleRows.length > MAX_TABLE_ROWS && (
                  <div className="flex items-center gap-1.5 border-b bg-amber-500/10 px-3 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                    {t('explorer.showingFirst', { shown: MAX_TABLE_ROWS.toLocaleString(), total: visibleRows.length.toLocaleString() })}
                  </div>
                )}
                <table className="w-full min-w-[720px] text-xs" style={{ tableLayout: 'auto' }}>
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {columns.map((c) => (
                        <th key={c.id} className="text-left font-semibold px-3 py-1.5 whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                      <th className="w-8 px-2 py-1.5" aria-label={t('common:actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {cappedRows.map((row) => (
                      <tr
                        key={`${row.namespace}/${row.name}`}
                        onClick={() => openRow(row)}
                        className={cn(
                          'group border-b border-border/50 cursor-pointer hover:bg-accent/40',
                          selected?.name === row.name && selected?.namespace === row.namespace && 'bg-accent/60',
                        )}
                      >
                        {columns.map((c) => (
                          <td key={c.id} className="px-3 py-1.5 align-top">
                            <CellValue col={c.id} row={row} metric={podMetrics.get(`${row.namespace}/${row.name}`)} />
                          </td>
                        ))}
                        <td className="px-1 py-1 align-top w-8">
                          <ActionsMenu
                            row={row}
                            kind={kind}
                            rbac={rbac}
                            hasWriteGrant={hasWriteGrant}
                            canPortForward={canPortForward}
                            onAction={runAction}
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 opacity-60 hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
            </div>
          </div>
          )}

          {/* Detail drawer */}
          {selected && (
            <DetailDrawer
              key={`${selected.namespace}/${selected.name}`}
              row={selected}
              kind={selectedKind ?? kind}
              related={!!selectedKind}
              backLabel={drawerBack?.row.name}
              onBack={drawerBack ? () => openRow(drawerBack.row, drawerBack.tab) : undefined}
              onOpenRelatedPod={(pod) => openRow(pod, 'overview', false, { kind: 'pods', back: { row: selected, tab: 'pods' } })}
              width={detailWidth}
              onResizeStart={(e) => startLeftResize(e, detailWidth, setDetailWidth, 0.72)}
              detail={detail}
              detailTab={detailTab}
              setDetailTab={setDetailTab}
              loading={detailLoading}
              error={detailError}
              onClose={closeDetail}
              theme={theme}
              connId={connId}
              context={context}
              scope={scope}
              rbac={rbac}
              hasWriteGrant={hasWriteGrant}
              canPortForward={canPortForward}
              onAction={runAction}
              editingYaml={editingYaml}
              setEditingYaml={setEditingYaml}
              editedYaml={editedYaml}
              setEditedYaml={setEditedYaml}
              onApply={(y) => setApplyYaml(y)}
            />
          )}

          {/* Local kubeconfig terminal (K8s v3) — a shell on the user's own
              machine, desktop-local only. A resizable flex sibling that PUSHES
              the table narrower (the table scrolls) rather than covering it. */}
          {canLocalShell && showLocalShell && (
            <div
              className="relative shrink-0 border-l bg-background flex flex-col overflow-hidden"
              style={{ width: shellWidth, maxWidth: '80vw', minWidth: 360 }}
            >
              {/* Left-edge resize handle — drag to widen/narrow the shell. */}
              <div
                onMouseDown={(e) => startLeftResize(e, shellWidth, setShellWidth, 0.8)}
                title={t('explorer.dragResize')}
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-10"
              />
              <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-blue-500/50 text-blue-500">
                    {t('explorer.localShellBadge')}
                  </Badge>
                  <span className="text-xs font-mono truncate">{context}</span>
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowLocalShell(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </header>
              <K8sTerminal
                connId={connId}
                context={context}
                source={{ kind: 'local-shell' }}
                scope={scope}
                theme={theme}
              />
            </div>
          )}
        </div>
      </div>

      {/* Scale dialog */}
      <Dialog open={!!scaleTarget} onOpenChange={(o) => { if (!o) setScaleTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('scale.title', { kind: singularKind(kind) })}</DialogTitle>
            <DialogDescription className="text-xs font-mono">
              {scaleTarget?.row.namespace ? `${scaleTarget.row.namespace}/` : ''}{scaleTarget?.row.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('scale.replicas')}</Label>
            <Input
              type="number"
              min={0}
              autoFocus
              value={scaleTarget?.replicas ?? 0}
              onChange={(e) => setScaleTarget((st) => st && { ...st, replicas: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              onKeyDown={(e) => { if (e.key === 'Enter') applyScale(); }}
              className="h-9 text-sm font-mono"
            />
            {scaleTarget?.replicas === 0 && (
              <p className="text-[11px] text-amber-500">{t('scale.toZeroHint')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setScaleTarget(null)}>{t('common:cancel')}</Button>
            <Button size="sm" onClick={applyScale}>{t('scale.scale')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Port-forward start dialog (Pods + Services, desktop-local) */}
      {pfTarget && (
        <PortForwardDialog
          row={pfTarget}
          kind={kind}
          connId={connId}
          context={context}
          scope={scope}
          onClose={() => setPfTarget(null)}
          onStarted={startedPf}
        />
      )}

      {/* Server-Side Apply dialog (from the editable YAML tab) */}
      {selected && applyYaml != null && (
        <K8sApplyDialog
          open
          onClose={() => setApplyYaml(null)}
          connId={connId}
          context={context}
          kind={kind}
          namespace={selected.namespace || undefined}
          name={selected.name}
          yaml={applyYaml}
          scope={scope}
          onApplied={() => {
            setApplyYaml(null);
            setEditingYaml(false);
            setEditedYaml('');
            loadResources();
            if (selected) openRow(selected, 'yaml', false);
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}

// ── Quick-actions dropdown (row + drawer header) ─────────────────────────────
function ActionsMenu({
  row, kind, rbac, hasWriteGrant, canPortForward, onAction, trigger,
}: {
  row: ResourceRow;
  kind: KindId;
  rbac: Record<string, boolean>;
  hasWriteGrant: boolean;
  canPortForward: boolean;
  onAction: (id: ActionId, row: ResourceRow) => void;
  trigger: React.ReactNode;
}) {
  const { t } = useTranslation('k8s');
  const ids = visibleActionIds(kind, isCordoned(row));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {ids.map((id) => {
          const meta = ACTION_META[id];
          const Icon = meta.icon;
          // Write ops need the grant; every action also honors an explicit
          // RBAC "no" (rbac[id] === false). Unknown/absent → allowed.
          // localOnly ops (port-forward) additionally require desktop-local.
          const grantOk = !meta.write || hasWriteGrant;
          const rbacOk = rbac[id] !== false;
          const localOk = !meta.localOnly || canPortForward;
          const permitted = grantOk && rbacOk && localOk;
          const reason = !grantOk
            ? t('actions.reasonWriteAccess')
            : !localOk
              ? t('actions.reasonPortForwardDesktop')
              : t('actions.reasonRbac');
          return (
            <DropdownMenuItem
              key={id}
              disabled={!permitted}
              title={!permitted ? reason : undefined}
              className={cn('gap-2 text-xs', meta.destructive && 'text-destructive focus:text-destructive')}
              onClick={(e) => { e.stopPropagation(); onAction(id, row); }}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(meta.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Port-forward start dialog (Pods + Services) ──────────────────────────────
// Fetches the object to seed the target port (first container port / service
// port), then POSTs to the local BE. localPort blank ⇒ the BE auto-assigns.
function PortForwardDialog({
  row, kind, connId, context, scope, onClose, onStarted,
}: {
  row: ResourceRow;
  kind: KindId;
  connId: string;
  context: string;
  scope: DBScope;
  onClose: () => void;
  onStarted: (pf: K8sPortForward) => void;
}) {
  const { t } = useTranslation('k8s');
  const bodyKind: 'pod' | 'service' = kind === 'services' ? 'service' : 'pod';
  const [targetPort, setTargetPort] = useState('');
  const [localPort, setLocalPort] = useState('');
  const [loadingDefault, setLoadingDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingDefault(true);
    const params: { context: string; namespace?: string; kind: string; name: string } = {
      context, kind, name: row.name,
    };
    if (row.namespace) params.namespace = row.namespace;
    k8sAPI.resource(connId, params, scope)
      .then((res) => {
        if (cancelled) return;
        const obj = (res.data as ResourceDetail)?.json as Record<string, unknown> | null;
        const dflt = defaultTargetPort(kind, obj);
        if (dflt != null) setTargetPort(String(dflt));
      })
      .catch(() => { /* leave blank — the user types the port */ })
      .finally(() => { if (!cancelled) setLoadingDefault(false); });
    return () => { cancelled = true; };
  }, [connId, context, kind, scope, row.name, row.namespace]);

  const start = async () => {
    const tp = parseInt(targetPort, 10);
    if (!Number.isFinite(tp) || tp <= 0) { setErr(t('portForward.errTargetPort')); return; }
    const lp = localPort.trim() ? parseInt(localPort, 10) : undefined;
    if (lp !== undefined && (!Number.isFinite(lp) || lp <= 0)) { setErr(t('portForward.errLocalPort')); return; }
    setErr('');
    setSubmitting(true);
    try {
      const res = await k8sAPI.portForward.start(connId, {
        context,
        namespace: row.namespace || undefined,
        kind: bodyKind,
        name: row.name,
        targetPort: tp,
        localPort: lp,
      }, scope);
      onStarted(res.data as K8sPortForward);
    } catch (e) {
      setErr(extractErr(e, t('portForward.startFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-blue-500" /> {t('portForward.title')}
          </DialogTitle>
          <DialogDescription className="text-xs font-mono">
            {t('portForward.subtitle', { kind: singularKind(kind), target: `${row.namespace ? `${row.namespace}/` : ''}${row.name}` })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('portForward.targetPort')}</Label>
            <Input
              type="number"
              min={1}
              autoFocus
              placeholder={loadingDefault ? t('common:loading') : bodyKind === 'service' ? t('portForward.targetPortService') : t('portForward.targetPortContainer')}
              value={targetPort}
              onChange={(e) => setTargetPort(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {t('portForward.localPort')} <span className="text-muted-foreground/60">{t('portForward.optional')}</span>
            </Label>
            <Input
              type="number"
              min={1}
              placeholder={t('portForward.localPortAuto')}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
              className="h-9 text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground">{t('portForward.localPortHint')}</p>
          </div>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>{t('common:cancel')}</Button>
          <Button size="sm" onClick={start} disabled={submitting || !targetPort.trim()} className="gap-1.5">
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            {t('portForward.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Default target port from a fetched object: pods → the first container's
// first declared containerPort; services → the first service port.
function defaultTargetPort(kind: KindId, obj: Record<string, unknown> | null): number | undefined {
  const spec = (obj?.spec ?? {}) as Record<string, unknown>;
  if (kind === 'services') {
    const ports = Array.isArray(spec.ports) ? spec.ports : [];
    const p0 = ports[0] as Record<string, unknown> | undefined;
    return p0 && typeof p0.port === 'number' ? p0.port : undefined;
  }
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  for (const c of containers) {
    const cp = c && typeof c === 'object' ? (c as Record<string, unknown>).ports : undefined;
    if (Array.isArray(cp) && cp.length > 0) {
      const p0 = cp[0] as Record<string, unknown>;
      if (typeof p0.containerPort === 'number') return p0.containerPort;
    }
  }
  return undefined;
}

// Small icon button that copies `value` and flips to a check for ~1.2s.
// `title` overrides the hover label (so a huge JSON value isn't dumped into the
// native tooltip).
function CopyButton({ value, title, className }: { value: string; title?: string; className?: string }) {
  const { t } = useTranslation('k8s');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn('h-6 w-6 shrink-0', className)}
      title={title ?? t('detail.copyValue', { value })}
      onClick={(e) => {
        // Rows open the detail drawer on click — copying must not.
        e.stopPropagation();
        navigator.clipboard.writeText(value)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
          .catch(() => { /* ignore */ });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

// ── Cell renderer ──────────────────────────────────────────────────────────
function CellValue({ col, row, metric }: { col: string; row: ResourceRow; metric?: K8sPodMetrics }) {
  if (col.startsWith('extra:')) {
    const v = row.extra?.[col.slice(6)] ?? '';
    // A pod's last termination is a problem worth seeing: OOM kills red,
    // other non-clean exits amber.
    const tone = col === 'extra:lastTermination' && v
      ? /OOMKilled/.test(v) ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'
      : 'text-muted-foreground';
    return <span className={cn('font-mono whitespace-nowrap', tone)}>{v || '—'}</span>;
  }
  switch (col) {
    case 'name':
      return (
        <div className="group/name flex items-center gap-1 min-w-0">
          <div className="flex flex-col min-w-0">
            <span className="font-mono truncate max-w-[360px]" title={row.name}>{row.name}</span>
            {row.namespace && <span className="text-[10px] text-muted-foreground">{row.namespace}</span>}
          </div>
          {/* Hover-revealed copy for the name (kept in layout so rows don't shift). */}
          <CopyButton value={row.name} className="h-5 w-5 opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100 transition-opacity" />
        </div>
      );
    case 'status': {
      if (!row.status) return <span className="text-muted-foreground">—</span>;
      const tone = statusTone(row.status);
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn('inline-block h-2 w-2 rounded-full', tone.dot)} />
          <span className={tone.text}>{row.status}</span>
        </span>
      );
    }
    case 'ready':
      return <span className="font-mono text-muted-foreground whitespace-nowrap">{row.ready || '—'}</span>;
    case 'cpu':
      return (
        <span className="font-mono tabular-nums text-muted-foreground whitespace-nowrap" title={metric ? `${metric.cpuMilli} millicores` : undefined}>
          {metric ? `${metric.cpuMilli}m` : '—'}
        </span>
      );
    case 'memory':
      return (
        <span className="font-mono tabular-nums text-muted-foreground whitespace-nowrap" title={metric ? `${metric.memBytes} bytes` : undefined}>
          {metric ? formatMemKube(metric.memBytes) : '—'}
        </span>
      );
    case 'restarts':
      return (
        <span className={cn('font-mono tabular-nums whitespace-nowrap', row.restarts > 0 ? 'text-amber-500' : 'text-muted-foreground')}>
          {row.restarts}
        </span>
      );
    case 'node':
      return <span className="font-mono text-muted-foreground truncate max-w-[220px] block" title={row.node}>{row.node || '—'}</span>;
    case 'age':
      return <span className="font-mono text-muted-foreground whitespace-nowrap">{row.age || '—'}</span>;
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

// ── Detail drawer ───────────────────────────────────────────────────────────
function DetailDrawer({
  row, kind, related, backLabel, onBack, onOpenRelatedPod,
  width, onResizeStart, detail, detailTab, setDetailTab, loading, error, onClose,
  theme, connId, context, scope,
  rbac, hasWriteGrant, canPortForward, onAction,
  editingYaml, setEditingYaml, editedYaml, setEditedYaml, onApply,
}: {
  row: ResourceRow;
  kind: KindId;
  /** Opened from a workload's Pods tab: read-focused (no actions / YAML edit —
   *  those are wired to the table's kind, not this pod's). */
  related?: boolean;
  backLabel?: string;
  onBack?: () => void;
  onOpenRelatedPod: (pod: ResourceRow) => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  detail: ResourceDetail | null;
  detailTab: DetailTab;
  setDetailTab: (t: DetailTab) => void;
  loading: boolean;
  error: string;
  onClose: () => void;
  theme: string;
  connId: string;
  context: string;
  scope: DBScope;
  rbac: Record<string, boolean>;
  hasWriteGrant: boolean;
  canPortForward: boolean;
  onAction: (id: ActionId, row: ResourceRow) => void;
  editingYaml: boolean;
  setEditingYaml: (v: boolean) => void;
  editedYaml: string;
  setEditedYaml: (v: string) => void;
  onApply: (yaml: string) => void;
}) {
  const { t } = useTranslation('k8s');
  const isPod = kind === 'pods';
  const tabs: { id: DetailTab; label: string; icon: typeof FileCode2 }[] = [
    { id: 'overview', label: t('detail.tabOverview'), icon: ListTree },
    { id: 'yaml', label: t('detail.tabYaml'), icon: FileCode2 },
    { id: 'describe', label: t('detail.tabDescribe'), icon: ScrollText },
    ...(isPod ? [{ id: 'logs' as DetailTab, label: t('detail.tabLogs'), icon: Radio }] : []),
    // Exec is write-ish: like Actions / YAML edit, not offered on a pod opened
    // from a workload (its gating is wired to the table's kind).
    ...(isPod && !related ? [{ id: 'terminal' as DetailTab, label: t('detail.tabTerminal'), icon: TerminalSquare }] : []),
    // metrics-server only serves pod/node metrics — gate on pods like Logs/Terminal.
    ...(isPod ? [{ id: 'metrics' as DetailTab, label: t('detail.tabMetrics'), icon: Activity }] : []),
    ...(POD_OWNER_KINDS.has(kind) ? [{ id: 'pods' as DetailTab, label: t('detail.tabPods'), icon: Box }] : []),
    ...(REVISION_KINDS.has(kind) ? [{ id: 'revisions' as DetailTab, label: t('detail.tabRevisions'), icon: History }] : []),
    { id: 'events', label: t('detail.tabEvents'), icon: Bell },
  ];
  // A related pod's actions would run against the table's kind — keep that
  // view read-focused.
  const canEditYaml = !related && hasWriteGrant;

  const obj = (detail?.json ?? null) as Record<string, unknown> | null;
  const containers = useMemo(() => podContainers(obj), [obj]);

  // Pods + revisions come from one /related call, fetched the first time
  // either tab opens and kept for the drawer's life (Refresh re-fetches).
  const [rel, setRel] = useState<K8sWorkloadRelated | null>(null);
  const [relLoading, setRelLoading] = useState(false);
  const [relErr, setRelErr] = useState('');
  const loadRelated = useCallback(async () => {
    setRelLoading(true);
    setRelErr('');
    try {
      const params: { context: string; namespace?: string; kind: string; name: string } = { context, kind, name: row.name };
      if (row.namespace) params.namespace = row.namespace;
      const res = await k8sAPI.related(connId, params, scope);
      setRel(res.data as K8sWorkloadRelated);
    } catch (err) {
      setRelErr(extractErr(err, t('related.loadFailed')));
    } finally {
      setRelLoading(false);
    }
  }, [connId, context, kind, row.name, row.namespace, scope, t]);
  useEffect(() => {
    if ((detailTab === 'pods' || detailTab === 'revisions') && !rel && !relLoading && !relErr) void loadRelated();
  }, [detailTab, rel, relLoading, relErr, loadRelated]);

  return (
    <div
      className="relative shrink-0 border-l bg-background flex flex-col overflow-hidden"
      style={{ width, maxWidth: '72vw', minWidth: 360 }}
    >
      {/* Left-edge resize handle — drag to widen/narrow the inspector. The
          table area (flex-1, min-w-0) reflows and scrolls horizontally. */}
      <div
        onMouseDown={onResizeStart}
        title={t('explorer.dragResize')}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-10"
      />
      <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] shrink-0" onClick={onBack} title={t('related.backTo', { name: backLabel })}>
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="max-w-[120px] truncate font-mono">{backLabel}</span>
            </Button>
          )}
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-blue-500/50 text-blue-500">
            {singularKind(kind)}
          </Badge>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-mono truncate">{row.name}</span>
            {row.namespace && <span className="text-[10px] text-muted-foreground">{row.namespace}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!related && (
            <ActionsMenu
              row={row}
              kind={kind}
              rbac={rbac}
              hasWriteGrant={hasWriteGrant}
              canPortForward={canPortForward}
              onAction={onAction}
              trigger={
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]">
                  <MoreVertical className="h-3.5 w-3.5" /> {t('detail.actions')}
                </Button>
              }
            />
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Tab strip */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b shrink-0 bg-muted/20 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setDetailTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] whitespace-nowrap transition-colors',
                detailTab === t.id ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/40',
              )}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('common:loading')}
          </div>
        ) : error && detailTab !== 'logs' && detailTab !== 'events' && detailTab !== 'terminal' && detailTab !== 'metrics' && detailTab !== 'pods' && detailTab !== 'revisions' ? (
          <ErrorBlock text={error} />
        ) : detailTab === 'overview' ? (
          <OverviewTab row={row} obj={obj} kind={kind} connId={connId} />
        ) : detailTab === 'yaml' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {editingYaml ? t('detail.editing') : t('detail.readOnly')}
              </span>
              {editingYaml && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{t('detail.unsaved')}</Badge>
              )}
              <div className="flex-1" />
              {editingYaml ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => { setEditingYaml(false); setEditedYaml(''); }}
                  >
                    {t('common:cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-[11px]"
                    disabled={!hasWriteGrant || rbac.edit === false}
                    title={!hasWriteGrant ? t('actions.reasonWriteAccess') : rbac.edit === false ? t('actions.reasonRbac') : undefined}
                    onClick={() => onApply(editedYaml || detail?.yaml || '')}
                  >
                    <Check className="h-3 w-3" /> {t('detail.applyBtn')}
                  </Button>
                </>
              ) : (
                !related && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-[11px]"
                    disabled={!canEditYaml || rbac.edit === false}
                    title={!hasWriteGrant ? t('actions.reasonWriteAccess') : rbac.edit === false ? t('actions.reasonRbac') : undefined}
                    onClick={() => setEditingYaml(true)}
                  >
                    <Pencil className="h-3 w-3" /> {t('common:edit')}
                  </Button>
                )
              )}
            </div>
            <div className="flex-1 min-h-0">
              <CodeEditor
                height="100%"
                language="yaml"
                // Per-kind model path drives monaco-yaml's fileMatch → the right
                // Kubernetes schema (completion/hover/validation) for this kind.
                path={`k8s-manifest/${(detail?.kind ?? 'resource').toLowerCase()}.yaml`}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={editingYaml ? editedYaml : (detail?.yaml ?? '')}
                onChange={(v) => { if (editingYaml) setEditedYaml(v ?? ''); }}
                options={{
                  readOnly: !editingYaml,
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  padding: { top: 8 },
                  lineNumbers: 'on',
                }}
              />
            </div>
          </div>
        ) : detailTab === 'terminal' ? (
          <K8sTerminal
            connId={connId}
            context={context}
            source={{ kind: 'pod-exec', namespace: row.namespace || undefined, pod: row.name, containers }}
            scope={scope}
            theme={theme}
          />
        ) : detailTab === 'describe' ? (
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed">
              {obj ? formatDescribe(obj) : t('detail.noObject')}
            </pre>
          </div>
        ) : detailTab === 'logs' ? (
          <PodLogsTab
            row={row}
            obj={obj}
            connId={connId}
            context={context}
            scope={scope}
          />
        ) : detailTab === 'pods' ? (
          <RelatedPodsTab rel={rel} loading={relLoading} error={relErr} onRefresh={() => void loadRelated()} onOpen={onOpenRelatedPod} />
        ) : detailTab === 'revisions' ? (
          <RevisionsTab rel={rel} loading={relLoading} error={relErr} onRefresh={() => void loadRelated()} />
        ) : detailTab === 'metrics' ? (
          <PodMetricsChart
            key={`${row.namespace}/${row.name}`}
            connId={connId}
            context={context}
            namespace={row.namespace || ''}
            podName={row.name}
            scope={scope}
            active={detailTab === 'metrics'}
          />
        ) : (
          <EventsTab row={row} connId={connId} context={context} scope={scope} theme={theme} />
        )}
      </div>
    </div>
  );
}

// ── Related pods / revisions tabs (workloads) ──────────────────────────────
function RelatedToolbar({ count, loading, onRefresh }: { count: number | null; loading: boolean; onRefresh: () => void }) {
  const { t } = useTranslation('k8s');
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
      {count != null && <span className="text-[10px] text-muted-foreground">{t('related.count', { count })}</span>}
      <div className="flex-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onRefresh} disabled={loading} title={t('common:refresh')}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function RelatedPodsTab({
  rel, loading, error, onRefresh, onOpen,
}: {
  rel: K8sWorkloadRelated | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onOpen: (pod: ResourceRow) => void;
}) {
  const { t } = useTranslation('k8s');
  const pods = rel?.pods ?? [];
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <RelatedToolbar count={rel ? pods.length : null} loading={loading} onRefresh={onRefresh} />
      <div className="flex-1 min-h-0 overflow-auto">
        {error || rel?.podsErr ? (
          <ErrorBlock text={error || rel!.podsErr!} />
        ) : !rel ? (
          <CenterHint text={t('common:loading')} />
        ) : pods.length === 0 ? (
          <CenterHint text={t('related.noPods')} />
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">{t('related.colName')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('related.colStatus')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('col.ready')}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t('col.restarts')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('col.node')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('col.age')}</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <tr key={`${p.namespace}/${p.name}`} className="border-t hover:bg-accent/40 cursor-pointer" onClick={() => onOpen(p)}>
                  <td className="px-3 py-1"><CellValue col="name" row={{ ...p, namespace: '' }} /></td>
                  <td className="px-2 py-1"><CellValue col="status" row={p} /></td>
                  <td className="px-2 py-1"><CellValue col="ready" row={p} /></td>
                  <td className="px-2 py-1 text-right"><CellValue col="restarts" row={p} /></td>
                  <td className="px-2 py-1"><CellValue col="node" row={p} /></td>
                  <td className="px-2 py-1"><CellValue col="age" row={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RevisionsTab({
  rel, loading, error, onRefresh,
}: {
  rel: K8sWorkloadRelated | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('k8s');
  const revs = rel?.revisions ?? [];
  const isRs = revs.some((r) => r.kind === 'ReplicaSet');
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <RelatedToolbar count={rel ? revs.length : null} loading={loading} onRefresh={onRefresh} />
      <div className="flex-1 min-h-0 overflow-auto">
        {error || rel?.revisionsErr ? (
          <ErrorBlock text={error || rel!.revisionsErr!} />
        ) : !rel ? (
          <CenterHint text={t('common:loading')} />
        ) : revs.length === 0 ? (
          <CenterHint text={t('related.noRevisions')} />
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">{t('related.colRevision')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('related.colName')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('related.colImages')}</th>
                {isRs && <th className="text-right px-2 py-1.5 font-medium">{t('related.colPods')}</th>}
                <th className="text-left px-2 py-1.5 font-medium">{t('related.colChangeCause')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('col.age')}</th>
              </tr>
            </thead>
            <tbody>
              {revs.map((r) => (
                <tr key={r.name} className={cn('border-t', r.current && 'bg-primary/5')}>
                  <td className="px-3 py-1 whitespace-nowrap">
                    <span className="font-mono tabular-nums">#{r.revision}</span>
                    {r.current && <Badge variant="success" className="ml-1.5 text-[9px] px-1 py-0">{t('related.current')}</Badge>}
                  </td>
                  <td className="px-2 py-1"><CellValue col="name" row={{ kind: r.kind, namespace: '', name: r.name, status: '', ready: '', restarts: 0, age: r.age, node: '' }} /></td>
                  <td className="px-2 py-1 font-mono text-muted-foreground break-all">{(r.images ?? []).join(', ') || '—'}</td>
                  {isRs && (
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                      {r.desired != null ? `${r.ready ?? 0}/${r.desired}` : '—'}
                    </td>
                  )}
                  <td className="px-2 py-1 text-muted-foreground break-words">{r.changeCause || '—'}</td>
                  <td className="px-2 py-1 font-mono text-muted-foreground whitespace-nowrap">{r.age || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Overview tab ────────────────────────────────────────────────────────────
function OverviewTab({ row, obj, kind, connId }: { row: ResourceRow; obj: Record<string, unknown> | null; kind: KindId; connId: string }) {
  const { t } = useTranslation('k8s');
  const meta = (obj?.metadata ?? {}) as Record<string, unknown>;
  const labels = (meta.labels ?? {}) as Record<string, string>;
  const annotations = (meta.annotations ?? {}) as Record<string, string>;
  const created = typeof meta.creationTimestamp === 'string' ? meta.creationTimestamp : '';

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3">
      <EntityNotes uri={k8sUri(connId, row.namespace, singularKind(kind), row.name)} />
      <div className="border rounded-md divide-y text-xs">
        <MetaRow k={t('detail.metaKind')} v={singularKind(kind)} />
        <MetaRow k={t('common:name')} v={row.name} mono />
        {row.namespace && <MetaRow k={t('detail.metaNamespace')} v={row.namespace} mono />}
        {row.status && <MetaRow k={t('common:status')} v={row.status} />}
        {row.ready && <MetaRow k={t('detail.metaReady')} v={row.ready} mono />}
        {kind === 'pods' && <MetaRow k={t('detail.metaRestarts')} v={String(row.restarts)} mono />}
        {row.node && <MetaRow k={t('detail.metaNode')} v={row.node} mono />}
        <MetaRow k={t('detail.metaAge')} v={row.age || '—'} mono />
        {created && <MetaRow k={t('detail.metaCreated')} v={created} mono />}
      </div>

      {kind === 'pods' && obj && <PodContainers obj={obj} />}

      {row.extra && Object.keys(row.extra).length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('detail.details')}</span>
          <div className="border rounded-md divide-y text-xs mt-1">
            {Object.entries(row.extra).map(([k, v]) => (
              <MetaRow key={k} k={titleize(k)} v={v || '—'} mono />
            ))}
          </div>
        </div>
      )}

      {Object.keys(labels).length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('detail.labels')}</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(labels).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[9px] px-1.5 py-0 font-mono font-normal">
                {k}={v}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {Object.keys(annotations).length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('detail.annotationsHeading', { count: Object.keys(annotations).length })}
          </span>
          <div className="border rounded-md divide-y text-xs mt-1">
            {Object.entries(annotations).map(([k, v]) => (
              <AnnotationRow key={k} k={k} v={v} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Events tab (filtered to the object) ─────────────────────────────────────
function EventsTab({
  row, connId, context, scope,
}: {
  row: ResourceRow;
  connId: string;
  context: string;
  scope: DBScope;
  theme: string;
}) {
  const { t } = useTranslation('k8s');
  const [events, setEvents] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!connId || !context) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    const params: { context: string; namespace?: string; kind: string } = { context, kind: 'events' };
    if (row.namespace) params.namespace = row.namespace;
    k8sAPI.resources(connId, params, scope)
      .then((res) => {
        if (cancelled) return;
        const all = (res.data as ResourceRow[]) ?? [];
        const mine = all.filter((e) => eventMatchesObject(e, row.name));
        setEvents(mine);
      })
      .catch((e) => { if (!cancelled) setErr(extractErr(e, t('events.loadFailed'))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connId, context, row.namespace, row.name, scope, t]);

  // Filter + virtualize: an object can accumulate thousands of events (7k+
  // seen), and rendering them all locks up the panel. Only the visible rows
  // are mounted; heights are measured dynamically since messages vary a lot.
  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return events;
    return events.filter((e) => {
      const hay = `${e.extra?.reason ?? e.status ?? ''} ${e.extra?.message ?? ''} ${e.extra?.type ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [events, q]);
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 12,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('events.loading')}
      </div>
    );
  }
  if (err) return <ErrorBlock text={err} />;
  if (events.length === 0) {
    return <CenterHint text={t('events.noEventsReference')} />;
  }
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 text-[11px] text-muted-foreground">
        <span>
          {t(events.length === 1 ? 'events.eventCountOne' : 'events.eventCountOther', { count: events.length.toLocaleString() })}
          {q && ` ${t('events.matchCount', { count: shown.length.toLocaleString() })}`}
        </span>
        {(events.length > 12 || q) && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('events.filterEvents')}
            className="ml-auto h-6 w-[170px] rounded border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
        )}
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto p-3">
        {shown.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('events.noMatchingEvents')}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const e = shown[vi.index];
              const type = e.extra?.type ?? '';
              const reason = e.extra?.reason ?? e.status ?? '';
              const message = e.extra?.message ?? '';
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  className="pb-2"
                >
                  <div className="border rounded-md overflow-hidden text-[11px]">
                    <div className="flex items-center gap-2 px-2 py-1 bg-muted/40 border-b">
                      {type && (
                        <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', type === 'Warning' ? 'bg-amber-500' : 'bg-emerald-500')} />
                      )}
                      <span className="font-medium">{reason || '—'}</span>
                      <span className="text-muted-foreground ml-auto font-mono shrink-0">{e.age || ''}</span>
                    </div>
                    {message && <p className="px-2 py-1 whitespace-pre-wrap break-words">{message}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared small components ──────────────────────────────────────────────────
// ── Pod containers (state + last termination) ─────────────────────────────
type K8sTerminated = { reason?: string; exitCode?: number; finishedAt?: string; message?: string };
type K8sContainerStatus = {
  name: string;
  restartCount?: number;
  ready?: boolean;
  state?: { running?: { startedAt?: string }; waiting?: { reason?: string; message?: string }; terminated?: K8sTerminated };
  lastState?: { terminated?: K8sTerminated };
};

function sinceText(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.floor(ms / 1000)}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// PodContainers shows each container's state and how it last ended — the
// reason (OOMKilled, Error…), exit code and when — which a restarted
// container otherwise only keeps in its YAML.
function PodContainers({ obj }: { obj: Record<string, unknown> }) {
  const { t } = useTranslation('k8s');
  const status = (obj.status ?? {}) as { containerStatuses?: K8sContainerStatus[]; initContainerStatuses?: K8sContainerStatus[] };
  const list = [
    ...(status.initContainerStatuses ?? []).map((c) => ({ c, init: true })),
    ...(status.containerStatuses ?? []).map((c) => ({ c, init: false })),
  ];
  if (list.length === 0) return null;
  const term = (x: K8sTerminated) => {
    const ago = sinceText(x.finishedAt);
    return `${x.reason || t('detail.terminated')} (${t('detail.exitCode', { code: x.exitCode ?? '?' })})${ago ? ` · ${t('detail.ago', { time: ago })}` : ''}`;
  };
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('detail.containers')}</span>
      <div className="border rounded-md divide-y text-xs mt-1">
        {list.map(({ c, init }) => {
          const st = c.state ?? {};
          const state = st.running
            ? `${t('detail.stateRunning')}${st.running.startedAt ? ` · ${t('detail.ago', { time: sinceText(st.running.startedAt) })}` : ''}`
            : st.waiting ? `${t('detail.stateWaiting')}: ${st.waiting.reason ?? ''}`
              : st.terminated ? term(st.terminated) : '—';
          const last = c.lastState?.terminated;
          const bad = (x?: K8sTerminated) => !!x && !(x.reason === 'Completed' && (x.exitCode ?? 0) === 0);
          return (
            <div key={(init ? 'init:' : '') + c.name} className="px-2.5 py-1.5 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium">{c.name}</span>
                {init && <Badge variant="outline" className="text-[9px] px-1 py-0">{t('detail.init')}</Badge>}
                <span className="ml-auto text-muted-foreground">{t('detail.restartsN', { count: c.restartCount ?? 0 })}</span>
              </div>
              <div className={cn('font-mono', st.waiting || bad(st.terminated) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{state}</div>
              {last && (
                <div className={cn('font-mono', /OOMKilled/.test(last.reason ?? '') ? 'text-red-500' : bad(last) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                  {t('detail.lastTermination')}: {term(last)}
                  {last.message && <span className="block text-muted-foreground truncate" title={last.message}>{last.message}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetaRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="px-2 py-1.5 flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground min-w-[92px] shrink-0 pt-px">{k}</span>
      <span className={cn('flex-1 break-all', mono && 'font-mono')}>{v}</span>
    </div>
  );
}

// Annotation value cell — when the value is JSON (e.g. the giant minified
// kubectl.kubernetes.io/last-applied-configuration) it's COLLAPSED by default
// behind a Show/Hide toggle, so a huge blob doesn't dominate the panel; a copy
// button is always available without expanding. Expanded, it's pretty-printed
// into a scrollable monospace box. Non-JSON values keep the plain wrapped
// rendering. Key column unchanged.
function AnnotationRow({ k, v }: { k: string; v: string }) {
  const { t } = useTranslation('k8s');
  const pretty = useMemo(() => tryPrettyJson(v), [v]);
  const [expanded, setExpanded] = useState(false);
  const lineCount = useMemo(() => (pretty ? pretty.split('\n').length : 0), [pretty]);

  // JSON values (e.g. last-applied-configuration) stack VERTICALLY — key on its
  // own line, the code box full-width BELOW it — so a wide blob isn't crammed
  // into a narrow side column. Collapsed by default; copy works without opening.
  if (pretty != null) {
    return (
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 min-w-0 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className="break-all text-left">{k}</span>
          </button>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {expanded ? t('detail.annHide') : t('detail.annShow', { count: lineCount })}
          </span>
          <CopyButton value={pretty} title={t('detail.copyJson')} />
        </div>
        {expanded && (
          <pre className="font-mono text-[11px] leading-relaxed whitespace-pre overflow-auto max-h-[300px] w-full rounded border bg-muted/30 p-2 mt-1">
            {pretty}
          </pre>
        )}
      </div>
    );
  }

  // Short / non-JSON values: key beside value.
  return (
    <div className="px-2 py-1.5 flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground min-w-[92px] shrink-0 pt-px break-all">{k}</span>
      <span className="flex-1 break-all font-mono">{v}</span>
    </div>
  );
}

function CenterHint({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground p-8 text-center">
      {icon}
      {text}
    </div>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="p-4 flex items-start gap-2 text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <pre className="whitespace-pre-wrap font-mono">{text}</pre>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

// statusTone maps a Kubernetes status/phase to a semantic dot + text color,
// matching the badge language used across the Redis/Kafka/S3 tools.
function statusTone(status: string): { dot: string; text: string } {
  const s = status.toLowerCase();
  if (['running', 'ready', 'active', 'bound', 'available', 'succeeded', 'complete', 'completed', 'healthy'].some((k) => s.includes(k))) {
    return { dot: 'bg-emerald-500', text: 'text-emerald-500' };
  }
  if (['pending', 'containercreating', 'creating', 'terminating', 'progressing', 'notready', 'not ready', 'waiting'].some((k) => s.includes(k))) {
    return { dot: 'bg-amber-500', text: 'text-amber-500' };
  }
  if (['fail', 'error', 'crashloop', 'evicted', 'unknown', 'imagepull', 'errimage', 'oomkilled', 'backoff'].some((k) => s.includes(k))) {
    return { dot: 'bg-destructive', text: 'text-destructive' };
  }
  return { dot: 'bg-muted-foreground/40', text: 'text-foreground/80' };
}

// Best-effort: does this event row reference the object with `name`? The BE's
// `extra` map is the wire contract but its exact keys can vary, so we probe a
// few likely keys and fall back to a name-substring match.
function eventMatchesObject(e: ResourceRow, name: string): boolean {
  const cand = [e.extra?.object, e.extra?.involvedObject, e.extra?.name, e.node]
    .filter((x): x is string => typeof x === 'string');
  if (cand.some((c) => c === name || c.endsWith('/' + name))) return true;
  return e.name.includes(name);
}

// Parse one SSE frame (the text between two blank lines) into its `event:` and
// concatenated `data:` fields. Watch frames are `event: <type>\ndata: <json>`.
function parseSseFrame(frame: string): { event: string; data: string } {
  let event = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(line.startsWith('data: ') ? 6 : 5);
  }
  return { event, data };
}

function singularKind(kind: string): string {
  const map: Record<string, string> = {
    nodes: 'Node', namespaces: 'Namespace', events: 'Event',
    pods: 'Pod', deployments: 'Deployment', statefulsets: 'StatefulSet',
    daemonsets: 'DaemonSet', jobs: 'Job', cronjobs: 'CronJob',
    services: 'Service', configmaps: 'ConfigMap', secrets: 'Secret', ingresses: 'Ingress',
  };
  return map[kind] ?? kind;
}

// Pretty-print a string value if it parses as a JSON object/array — returns the
// 2-space indented form, or null when it isn't JSON (leave the raw value alone).
// Cheap `{`/`[` prefix guard avoids JSON.parse on every plain annotation.
function tryPrettyJson(v: string): string | null {
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object') return JSON.stringify(parsed, null, 2);
    return null;
  } catch {
    return null;
  }
}

function titleize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// formatDescribe renders a k8s object as an indented key: value listing, in the
// spirit of `kubectl describe` (nested objects/arrays indented under their key).
function formatDescribe(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return `${pad}<none>`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${pad}[]`;
    return obj.map((v) => {
      if (v && typeof v === 'object') return `${pad}-\n${formatDescribe(v, indent + 1)}`;
      return `${pad}- ${String(v)}`;
    }).join('\n');
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries.map(([k, v]) => {
      if (v && typeof v === 'object') return `${pad}${k}:\n${formatDescribe(v, indent + 1)}`;
      return `${pad}${k}: ${String(v)}`;
    }).join('\n');
  }
  return `${pad}${String(obj)}`;
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
