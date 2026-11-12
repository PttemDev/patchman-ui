import { useTranslation } from 'react-i18next';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, CheckCircle2, CircleHelp, Crosshair, ExternalLink, EyeOff, FileKey2, FileText, FolderClosed, FolderInput,
  FolderOpen, FolderTree,
  KeyRound, Link2, OctagonX, Radar, Route, X,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import type { ServiceMapEdge, ServiceMapGraph, ServiceMapNode, Tab } from '@/types';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import { openRabbitCluster } from '@/components/rabbit/rabbitUtil';
import { HealthIcon, NodeIcon } from './ServiceNodeCard';
import { errorKnown, fmtMs, fmtPct, fmtRps, isErrorStatus, nodeClass, CLASS_VAR, HEALTH_VAR } from './serviceMapUtil';

/** Where a node is on the current view: drawn, folded into a namespace, or
 *  hidden by the filters / namespace scope. */
export type NodePlace = { state: 'shown' } | { state: 'folded'; group: string } | { state: 'hidden' };

interface Props {
  graph: ServiceMapGraph;
  /** The map before filters and folding: a node's numbers count every call,
   *  so its call lists must too. */
  full: ServiceMapGraph;
  placeOf: (id: string) => NodePlace;
  node?: ServiceMapNode;
  edge?: ServiceMapEdge;
  tab: Tab;
  /** Coroot connection base URLs by connection id (for "Open in Coroot"). */
  corootUrls: string[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClose: () => void;
  /** Members of a folded namespace (when `node` is one). */
  members?: ServiceMapNode[];
  onOpenMember?: (id: string) => void;
  onExpand?: () => void;
  /** Set when the node's namespace was opened up and can fold again. */
  onCollapse?: () => void;
  onFocus: (depth: number) => void;
  focusDepth?: number;
  onOnlyNamespace?: (ns: string) => void;
}

const HEALTH_ORDER: Record<string, number> = { critical: 0, warning: 1, unknown: 2, ok: 3 };

function openTool(n: ServiceMapNode) {
  const c = n.connection;
  if (!c) return;
  const add = useRequestStore.getState().addTab;
  const base = { method: 'GET', url: '' } as const;
  switch (c.tool) {
    case 'db': add({ ...base, type: 'db', name: c.name, dbConnectionId: c.id, dbQuery: '' }, true); break;
    case 'kafka': add({ ...base, type: 'kafka', name: `Kafka · ${c.name}`, kafkaConnectionId: c.id }, true); break;
    case 'redis': add({ ...base, type: 'redis', name: `Redis · ${c.name}`, redisConnectionId: c.id, redisDb: 0 }, true); break;
    case 'es': add({ ...base, type: 'es', name: `ES · ${c.name}`, esConnectionId: c.id }, true); break;
    case 's3': add({ ...base, type: 's3', name: `S3 · ${c.name}`, s3ConnectionId: c.id, s3Prefix: '' }, true); break;
    case 'rabbit': openRabbitCluster(c.id, c.name); break;
  }
}

function openInK8s(tab: Tab, n: ServiceMapNode) {
  if (!tab.smK8sConnectionId || !n.k8s) return;
  const kind = { Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', CronJob: 'cronjobs', Service: 'services', Ingress: 'ingresses' }[n.k8s.kind];
  useRequestStore.getState().addTab({
    type: 'k8s', name: `K8s · ${n.k8s.name}`, method: 'GET', url: '',
    k8sConnectionId: tab.smK8sConnectionId, k8sContext: tab.smK8sContext, k8sNamespace: n.k8s.namespace,
    ...(kind ? { k8sKind: kind, k8sView: 'resources' as const } : {}),
  }, true);
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--sm-card-border)' }}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums" style={{ color: tone ?? 'var(--sm-text)' }}>{value}</div>
    </div>
  );
}

export function ServiceMapDetail({
  graph, full, placeOf, node, edge, tab, corootUrls, onSelectNode, onSelectEdge, onClose, members, onOpenMember, onExpand, onCollapse, onFocus, focusDepth, onOnlyNamespace,
}: Props) {
  const { t } = useTranslation('servicemap');
  const byId = new Map([...full.nodes, ...graph.nodes].map((n) => [n.id, n]));
  // A folded namespace's links live on the view; a single node's on the full map.
  const linksOf = node?.group ? graph.edges : full.edges;
  const label = (id: string) => {
    const n = byId.get(id);
    return n ? (n.namespace && !n.group ? `${n.name} · ${n.namespace}` : n.name) : id;
  };
  if (!node && !edge) return null;

  const statsBlock = (s: ServiceMapEdge['stats'], p95Label = t('detail.p95')) => (
    <div className="grid grid-cols-3 gap-2">
      <Metric label={t('detail.rps')} value={s.hasRed ? fmtRps(s.rps) : '—'} />
      <Metric label={t('detail.errors')} value={errorKnown(s) ? fmtPct(s.errorRate) : '—'}
        tone={errorKnown(s) && s.errorRate >= 0.05 ? 'var(--sm-crit)' : errorKnown(s) && s.errorRate >= 0.01 ? 'var(--sm-warn)' : undefined} />
      <Metric label={p95Label} value={s.rateOnly ? '—' : fmtMs(s.p95Ms)} />
    </div>
  );

  return (
    <aside className="absolute right-3 top-3 bottom-3 z-10 w-[360px] max-w-[calc(100%-24px)] overflow-y-auto rounded-xl sm-card sm-panel p-3 space-y-3" aria-label={t('detail.title')}>
      <div className="flex items-start gap-2">
        {node ? (
          <div className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in oklab, var(${CLASS_VAR[nodeClass(node)]}) 16%, transparent)`, color: `var(${CLASS_VAR[nodeClass(node)]})` }}>
            <NodeIcon node={node} className="h-4.5 w-4.5" />
          </div>
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center bg-muted"><Route className="h-4 w-4" /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-words" style={{ color: 'var(--sm-text)' }}>
            {node ? node.name : `${label(edge!.from)} → ${label(edge!.to)}`}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {node?.group
              ? t('detail.namespaceGroup', { count: node.group.members })
              : node
                ? [node.namespace, node.k8s?.kind ?? t(`kind.${node.kind}`), node.subtype !== 'http' ? node.subtype : ''].filter(Boolean).join(' · ')
                : [edge!.protocol, t(`flow.${edge!.flow}`), (edge!.calls ?? 0) > 1 ? t('detail.foldedCalls', { count: edge!.calls }) : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label={t('common:close')}><X className="h-4 w-4" /></Button>
      </div>

      {node && (
        <>
          <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: `var(${HEALTH_VAR[node.health] ?? '--sm-unknown'})` }}>
            <HealthIcon health={node.health} className="h-4 w-4" /> {t(`health.${node.health}`)}
            {node.replicas && <span className="ml-auto text-muted-foreground font-normal">{t('detail.replicas', { value: node.replicas })}</span>}
          </div>
          {statsBlock(node.stats, node.group ? t('detail.p95Worst') : undefined)}
          <div className="flex flex-wrap items-center gap-1.5">
            {node.group && onExpand && (
              <Button size="sm" className="h-7 text-xs" onClick={onExpand}>
                <FolderOpen className="h-3.5 w-3.5 mr-1" /> {t('detail.expand')}
              </Button>
            )}
            <div className="inline-flex items-center rounded-md border overflow-hidden" role="group" aria-label={t('detail.focus')}>
              <span className="flex items-center gap-1 px-2 text-xs text-muted-foreground"><Crosshair className="h-3.5 w-3.5" />{t('detail.focus')}</span>
              {[1, 2, 3].map((d) => (
                <button key={d} type="button" onClick={() => onFocus(d)} title={t('detail.focusHops', { count: d })}
                  className={cn('h-7 w-7 border-l text-xs font-mono', focusDepth === d ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50')}>
                  {d}
                </button>
              ))}
            </div>
            {onCollapse && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={onCollapse}>
                <FolderInput className="h-3.5 w-3.5 mr-1" /> {t('detail.collapse', { name: node.namespace })}
              </Button>
            )}
            {onOnlyNamespace && (node.group ? node.group.namespace : node.namespace) && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => onOnlyNamespace(node.group ? node.group.namespace : node.namespace!)}>
                <FolderTree className="h-3.5 w-3.5 mr-1" /> {t('detail.onlyNamespace')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {node.connection && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => openTool(node)}>
                <Link2 className="h-3.5 w-3.5 mr-1" /> {t('detail.openConnection', { name: node.connection.name })}
              </Button>
            )}
            {node.k8s && tab.smK8sConnectionId && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => openInK8s(tab, node)}>
                <Boxes className="h-3.5 w-3.5 mr-1" /> {t('detail.openK8s')}
              </Button>
            )}
            {node.coroot && corootUrls.length > 0 && (
              <Button size="sm" variant="secondary" className="h-7 text-xs"
                onClick={() => window.open(`${corootUrls[0].replace(/\/+$/, '')}/p/${encodeURIComponent(node.coroot!.project)}/app/${encodeURIComponent(node.coroot!.appId)}`, '_blank', 'noopener')}>
                <Radar className="h-3.5 w-3.5 mr-1" /> {t('detail.openCoroot')} <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            )}
          </div>
          {(node.images?.length || node.services?.length || node.address) ? (
            <dl className="space-y-1 text-[11px]">
              {node.address && <Row k={t('detail.address')} v={node.address} />}
              {node.services?.length ? <Row k={t('detail.services')} v={node.services.join(', ')} /> : null}
              {node.images?.length ? <Row k={t('detail.images')} v={node.images.join(', ')} /> : null}
              <Row k={t('detail.sources')} v={node.sources.join(', ')} />
            </dl>
          ) : null}
          {members && members.length > 0 && onOpenMember && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Boxes className="h-3.5 w-3.5" />{t('detail.members')} <span className="opacity-60">{members.length}</span>
              </div>
              <div className="flex items-center gap-1.5 pl-2 pr-1 text-[10px] text-muted-foreground">
                <span className="flex-1 pl-[30px]">{t('detail.colNode')}</span>
                <span className="w-12 text-right">{t('detail.colRps')}</span>
                <span className="w-10 text-right" title={t('detail.colErrorsHint')}>{t('detail.colErrors')}</span>
                <span className="w-12 text-right">{t('detail.p95')}</span>
              </div>
              {[...members]
                .sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || (b.stats.rps ?? 0) - (a.stats.rps ?? 0))
                .slice(0, 200)
                .map((m) => {
                  const errTone = errorKnown(m.stats) && m.stats.errorRate >= 0.05 ? 'var(--sm-crit)' : errorKnown(m.stats) && m.stats.errorRate >= 0.01 ? 'var(--sm-warn)' : undefined;
                  return (
                    <button key={m.id} type="button" onClick={() => onOpenMember(m.id)} title={t('detail.openMember', { name: m.name })}
                      className="w-full flex items-center gap-1.5 rounded-md pl-2 pr-1 py-1 text-left text-[11px] hover:bg-accent/50">
                      <span style={{ color: `var(${HEALTH_VAR[m.health] ?? '--sm-unknown'})` }} title={t(`health.${m.health}`)}><HealthIcon health={m.health} className="h-3 w-3" /></span>
                      <NodeIcon node={m} className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{m.name}</span>
                      <span className="shrink-0 font-mono tabular-nums w-12 text-right">{m.stats.hasRed ? fmtRps(m.stats.rps) : '—'}</span>
                      <span className="shrink-0 font-mono tabular-nums w-10 text-right" style={{ color: errTone }}>
                        {errorKnown(m.stats) ? fmtPct(m.stats.errorRate) : '—'}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums w-12 text-right text-muted-foreground">{errorKnown(m.stats) ? fmtMs(m.stats.p95Ms) : '—'}</span>
                    </button>
                  );
                })}
            </div>
          )}
          <Responses stats={node.stats} t={t} />
          {!node.group && (
            <ErrorSources node={node} edges={linksOf.filter((e) => e.to === node.id)} label={label} placeOf={placeOf} onSelectEdge={onSelectEdge} t={t} />
          )}
          <Neighbours title={t('detail.calls')} who={t('detail.colTarget')} icon={<ArrowDownRight className="h-3.5 w-3.5" />} edges={linksOf.filter((e) => e.from === node.id)}
            other={(e) => e.to} label={label} placeOf={placeOf} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} t={t} />
          <Neighbours title={t('detail.calledBy')} who={t('detail.colCaller')} icon={<ArrowUpRight className="h-3.5 w-3.5" />} edges={linksOf.filter((e) => e.to === node.id)}
            other={(e) => e.from} label={label} placeOf={placeOf} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} t={t} />
        </>
      )}

      {edge && (
        <>
          {statsBlock(edge.stats)}
          {edge.stats.conns ? <p className="text-[11px] text-muted-foreground">{t('detail.conns', { count: Math.round(edge.stats.conns) })}</p> : null}
          {edge.issue && <p className="text-[11px] rounded bg-destructive/10 text-destructive px-2 py-1">⚠ {edge.issue}</p>}
          <Responses stats={edge.stats} t={t} />
          {!edge.stats.hasRed && !edge.stats.conns && <p className="text-[11px] text-muted-foreground">{t('detail.declaredOnly')}</p>}
          <dl className="space-y-1 text-[11px]">
            <Row k={t('detail.sources')} v={edge.sources.join(', ')} />
          </dl>
          {edge.evidence?.length ? (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('detail.evidence')}</div>
              {edge.evidence.map((ev, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--sm-card-border)' }}>
                  {ev.source === 'secret' ? <KeyRound className="h-3.5 w-3.5 mt-px text-amber-500" /> : ev.source === 'configMap' ? <FileText className="h-3.5 w-3.5 mt-px text-sky-500" /> : <FileKey2 className="h-3.5 w-3.5 mt-px text-muted-foreground" />}
                  <div className="min-w-0">
                    <div className="font-medium">{t(`evidence.${ev.source}`)}{ev.name ? ` ${ev.name}` : ''}{ev.key ? ` · ${ev.key}` : ''}</div>
                    {ev.extracted && <div className="font-mono text-muted-foreground break-all">{ev.extracted}</div>}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">{t('detail.evidenceNote')}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" className="h-7 max-w-full text-xs" onClick={() => onSelectNode(edge.from)}>
              <span className="truncate">{label(edge.from)}</span>
            </Button>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <Button size="sm" variant="secondary" className="h-7 max-w-full text-xs" onClick={() => onSelectNode(edge.to)}>
              <span className="truncate">{label(edge.to)}</span>
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono break-all">{v}</dd>
    </div>
  );
}

function statusHelp(t: TFunction, status: string): string {
  if (status === 'unknown') return t('status.unknown');
  if (status === 'failed' || status === 'failure') return t('status.failed');
  if (status === 'ok' || status === 'success' || status === 'grpc:OK') return t('status.ok');
  if (status.startsWith('grpc:')) return t('status.grpc');
  if (status.startsWith('5')) return t('status.5xx');
  if (status.startsWith('4')) return t('status.4xx');
  if (status.startsWith('3')) return t('status.3xx');
  if (status.startsWith('2')) return t('status.ok');
  return '';
}

/** What the calls came back with: requests/s per status, errors marked. */
function Responses({ stats, t }: { stats: ServiceMapEdge['stats']; t: TFunction }) {
  const entries = Object.entries(stats.statuses ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('detail.responses')}</div>
      {entries.slice(0, 12).map(([status, v]) => {
        const err = isErrorStatus(status);
        const share = v / total;
        const help = statusHelp(t, status);
        const tone = err ? 'var(--sm-crit)' : status === 'unknown' ? 'var(--sm-unknown)' : 'var(--sm-ok)';
        return (
          <div key={status} className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span style={{ color: tone }}>
                {err ? <OctagonX className="h-3 w-3" /> : status === 'unknown' ? <CircleHelp className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              </span>
              <span className="shrink-0 font-mono font-medium" style={{ color: err ? 'var(--sm-crit)' : 'var(--sm-text)' }}>{status}</span>
              <span className="min-w-0 truncate text-muted-foreground" title={help}>{help}</span>
              <span className="ml-auto shrink-0 font-mono tabular-nums">{fmtRps(v)}</span>
              <span className="w-11 shrink-0 text-right font-mono tabular-nums text-muted-foreground">{fmtPct(share)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--sm-card-border)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(1, share * 100)}%`, background: tone }} />
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">{t('detail.responsesNote')}</p>
    </div>
  );
}

function PlaceMark({ place, t }: { place: NodePlace; t: TFunction }) {
  if (place.state === 'shown') return null;
  const tip = place.state === 'folded' ? t('detail.foldedInto', { name: place.group }) : t('detail.hiddenByFilters');
  return (
    <span className="shrink-0 text-muted-foreground" title={tip} aria-label={tip}>
      {place.state === 'folded' ? <FolderClosed className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
    </span>
  );
}

/** Which callers the node's errors come from, worst first. */
function ErrorSources({ node, edges, label, placeOf, onSelectEdge, t }: {
  node: ServiceMapNode; edges: ServiceMapEdge[]; label: (id: string) => string; placeOf: (id: string) => NodePlace;
  onSelectEdge: (id: string) => void; t: TFunction;
}) {
  const total = errorKnown(node.stats) ? node.stats.rps * node.stats.errorRate : 0;
  if (total <= 0) return null;
  const rows = edges
    .filter((e) => errorKnown(e.stats) && e.stats.errorRate > 0 && e.flow !== 'consume')
    .map((e) => ({ e, err: e.stats.rps * e.stats.errorRate }))
    .sort((a, b) => b.err - a.err)
    .slice(0, 6);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-0.5 rounded-lg border px-2 py-2" style={{ borderColor: 'color-mix(in oklab, var(--sm-crit) 35%, transparent)' }}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--sm-crit)' }}>
        <OctagonX className="h-3.5 w-3.5" />{t('detail.errorsFrom')}
      </div>
      <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
        <span className="flex-1">{t('detail.colCaller')}</span>
        <span className="w-14 text-right" title={t('detail.errRpsHint')}>{t('detail.colErrRps')}</span>
        <span className="w-12 text-right">{t('detail.colShare')}</span>
      </div>
      {rows.map(({ e, err }) => (
        <button key={e.id} type="button" onClick={() => onSelectEdge(e.id)} title={t('detail.openCall')}
          className="w-full flex items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] hover:bg-accent/50">
          <span className="truncate flex-1">{label(e.from)}</span>
          <PlaceMark place={placeOf(e.from)} t={t} />
          <span className="w-14 shrink-0 text-right font-mono tabular-nums" style={{ color: 'var(--sm-crit)' }}>{fmtRps(err)}</span>
          <span className="w-12 shrink-0 text-right font-mono tabular-nums text-muted-foreground">{fmtPct(Math.min(1, err / total))}</span>
        </button>
      ))}
    </div>
  );
}

function Neighbours({ title, who, icon, edges, other, label, placeOf, onSelectNode, onSelectEdge, t }: {
  title: string; who: string; icon: React.ReactNode; edges: ServiceMapEdge[]; other: (e: ServiceMapEdge) => string; label: (id: string) => string;
  placeOf: (id: string) => NodePlace; onSelectNode: (id: string) => void; onSelectEdge: (id: string) => void; t: TFunction;
}) {
  if (edges.length === 0) return null;
  const sorted = [...edges].sort((a, b) => (b.stats.rps ?? 0) - (a.stats.rps ?? 0));
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">{icon}{title} <span className="opacity-60">{edges.length}</span></div>
      <div className="flex items-center gap-2 pl-2 pr-6 text-[10px] text-muted-foreground">
        <span className="flex-1">{who}</span>
        <span className="w-12 text-right">{t('detail.colProtocol')}</span>
        <span className="w-14 text-right">{t('detail.colRps')}</span>
        <span className="w-12 text-right" title={t('detail.colErrorsHint')}>{t('detail.colErrors')}</span>
      </div>
      {sorted.map((e) => {
        const errTone = errorKnown(e.stats) && e.stats.errorRate >= 0.05 ? 'var(--sm-crit)' : errorKnown(e.stats) && e.stats.errorRate >= 0.01 ? 'var(--sm-warn)' : undefined;
        return (
          <div key={e.id} className="flex items-center rounded-md hover:bg-accent/50">
            <button type="button" onClick={() => onSelectEdge(e.id)} title={t('detail.openCall')}
              className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2 text-left text-[11px]">
              <span className="truncate flex-1">{label(other(e))}</span>
              <PlaceMark place={placeOf(other(e))} t={t} />
              <span className="w-12 shrink-0 truncate text-right font-mono tabular-nums text-muted-foreground">{e.protocol}</span>
              <span className="w-14 shrink-0 text-right font-mono tabular-nums">{e.stats.hasRed ? fmtRps(e.stats.rps) : '—'}</span>
              <span className="w-12 shrink-0 text-right font-mono tabular-nums" style={{ color: errTone }}>
                {errorKnown(e.stats) ? fmtPct(e.stats.errorRate) : '—'}
              </span>
            </button>
            <button type="button" onClick={() => onSelectNode(other(e))} title={t('detail.goToNode', { name: label(other(e)) })}
              aria-label={t('detail.goToNode', { name: label(other(e)) })}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
