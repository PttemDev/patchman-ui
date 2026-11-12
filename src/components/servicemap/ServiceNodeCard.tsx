import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps, type Node } from '@xyflow/react';
import {
  Archive, Box, Boxes, CheckCircle2, CircleHelp, Database, DoorOpen, Globe, Layers, Link2, OctagonX, Rabbit, Radio, Search, TriangleAlert, Zap,
} from 'lucide-react';
import type { ServiceMapGroup, ServiceMapNode } from '@/types';
import { cn } from '@/lib/utils';
import { NODE_H, NODE_W, errorKnown, fmtMs, fmtPct, fmtRps, nodeClass, CLASS_VAR, HEALTH_VAR } from './serviceMapUtil';

export interface CardData extends Record<string, unknown> {
  node: ServiceMapNode;
  selected: boolean;
  dim: boolean;
  /** Outside the chosen namespaces, shown only as context. */
  faint: boolean;
  isNew: boolean;
  /** Largest request rate on the map, for the rps bar. */
  maxRps: number;
  labels: CardLabels;
}

export interface CardLabels {
  health: Record<string, string>;
  rps: string;
  noTraffic: string;
  conn: string;
  /** "42 nodes · 3 data stores" for a folded namespace. */
  group: (g: ServiceMapGroup) => string;
  openGroup: string;
}

/** Below this zoom cards switch to a compact, larger-type face. */
const FAR_ZOOM = 0.42;

export type CardNode = Node<CardData, 'svc'>;

export function NodeIcon({ node, className }: { node: Pick<ServiceMapNode, 'kind' | 'subtype' | 'group'>; className?: string }) {
  const s = node.subtype ?? '';
  if (node.group) return <Boxes className={className} />;
  if (node.kind === 'ingress') return <DoorOpen className={className} />;
  if (node.kind === 'messaging') return s === 'kafka' ? <Radio className={className} /> : s === 'rabbitmq' ? <Rabbit className={className} /> : <Layers className={className} />;
  if (node.kind === 'datastore') {
    if (s === 'redis' || s === 'memcached') return <Zap className={className} />;
    if (s === 'elasticsearch') return <Search className={className} />;
    if (s === 's3') return <Archive className={className} />;
    return <Database className={className} />;
  }
  if (node.kind === 'external') return <Globe className={className} />;
  return <Box className={className} />;
}

export function HealthIcon({ health, className }: { health: string; className?: string }) {
  if (health === 'ok') return <CheckCircle2 className={className} />;
  if (health === 'warning') return <TriangleAlert className={className} />;
  if (health === 'critical') return <OctagonX className={className} />;
  return <CircleHelp className={className} />;
}

/** Success / error ring around the type icon. */
function Ring({ node }: { node: ServiceMapNode }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const known = errorKnown(node.stats) && node.stats.rps > 0;
  const err = known ? Math.min(1, node.stats.errorRate) : 0;
  const okLen = known ? c * (1 - err) : 0;
  const errLen = known ? c * err : 0;
  const tone = `var(${HEALTH_VAR[node.health] ?? '--sm-unknown'})`;
  return (
    <svg width={46} height={46} viewBox="0 0 46 46" className="absolute inset-0" aria-hidden>
      <circle cx={23} cy={23} r={r} fill="none" stroke="var(--sm-card-border)" strokeWidth={3.5} strokeDasharray={known ? undefined : '3 4'} />
      {known && (
        <>
          <circle cx={23} cy={23} r={r} fill="none" stroke={tone} strokeWidth={3.5} strokeLinecap="round"
            strokeDasharray={`${Math.max(0, okLen - (errLen > 0 ? 2 : 0))} ${c}`} transform="rotate(-90 23 23)"
            className="sm-ring-glow" style={{ ['--sm-glow' as string]: tone }} />
          {errLen > 0 && (
            <circle cx={23} cy={23} r={r} fill="none" stroke="var(--sm-crit)" strokeWidth={3.5} strokeLinecap="round"
              strokeDasharray={`${Math.max(1.5, errLen - 2)} ${c}`} strokeDashoffset={-okLen} transform="rotate(-90 23 23)" />
          )}
        </>
      )}
    </svg>
  );
}

function HealthCounts({ g, labels }: { g: ServiceMapGroup; labels: CardLabels }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-medium">
      {(['critical', 'warning', 'ok'] as const).map((h) => (g.health[h] ? (
        <span key={h} className="flex items-center gap-0.5" style={{ color: `var(${HEALTH_VAR[h]})` }} title={labels.health[h]}>
          <HealthIcon health={h} className="h-3 w-3" />{g.health[h]}
        </span>
      ) : null))}
    </span>
  );
}

function ServiceNodeCardImpl({ data }: NodeProps<CardNode>) {
  const { node, selected, dim, faint, isNew, maxRps, labels } = data;
  const far = useStore((st) => st.transform[2] < FAR_ZOOM);
  const cls = nodeClass(node);
  const s = node.stats;
  const g = node.group;
  const traffic = s.hasRed && s.rps > 0;
  const bar = traffic && maxRps > 0 ? Math.max(0.04, Math.log10(1 + s.rps) / Math.log10(1 + maxRps)) : 0;
  const healthTone = `var(${HEALTH_VAR[node.health] ?? '--sm-unknown'})`;
  const handles = (
    <>
      <Handle type="target" position={Position.Top} className="!opacity-0 !w-2 !h-2 !min-w-0 !min-h-0 !border-0" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-2 !h-2 !min-w-0 !min-h-0 !border-0" isConnectable={false} />
    </>
  );
  const opacity = dim ? 0.16 : faint ? 0.45 : 1;
  if (far) {
    // Zoomed out: name, namespace and health only, in type that stays
    // readable at a third of the size.
    return (
      <div
        className={cn('sm-card relative rounded-xl overflow-hidden select-none', g && 'sm-group', isNew && 'sm-new')}
        data-selected={selected}
        data-health={node.health}
        style={{ width: NODE_W, height: NODE_H, opacity }}
        title={node.namespace ? `${node.namespace}/${node.name}` : node.name}
      >
        {handles}
        <div className="absolute inset-y-0 left-0 w-[6px]" style={{ background: healthTone }} />
        <div className="flex h-full flex-col justify-center gap-1 pl-5 pr-3">
          <div className="flex items-center gap-2 min-w-0" style={{ color: 'var(--sm-text)' }}>
            <span style={{ color: `var(${CLASS_VAR[cls]})` }}><NodeIcon node={node} className="h-6 w-6 shrink-0" /></span>
            <span className="truncate text-[22px] font-semibold leading-tight">{node.name}</span>
          </div>
          <div className="truncate text-[15px]" style={{ color: 'var(--sm-text-2)' }}>
            {g ? labels.group(g) : node.namespace || node.subtype}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn('sm-card relative rounded-xl overflow-hidden select-none', g && 'sm-group', isNew && 'sm-new')}
      data-selected={selected}
      data-health={node.health}
      style={{ width: NODE_W, height: NODE_H, opacity }}
      title={g ? labels.openGroup : undefined}
    >
      {handles}
      {/* class accent along the top edge */}
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, var(${CLASS_VAR[cls]}), transparent)` }} />
      <div className="flex h-full gap-2.5 px-2.5 pt-2.5 pb-2">
        <div className="relative h-[46px] w-[46px] shrink-0">
          <Ring node={node} />
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: `var(${CLASS_VAR[cls]})` }}>
            <NodeIcon node={node} className="h-[18px] w-[18px]" />
          </div>
        </div>
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[13px] font-semibold leading-tight" style={{ color: 'var(--sm-text)' }} title={node.namespace ? `${node.namespace}/${node.name}` : node.name}>
              {node.name}
            </span>
            {node.connection && <Link2 className="h-3 w-3 shrink-0" style={{ color: 'var(--sm-accent)' }} aria-label={labels.conn} />}
          </div>
          <div className="mt-0.5 flex items-center gap-1 min-w-0 text-[10px]" style={{ color: 'var(--sm-text-2)' }}>
            {g ? (
              <>
                <span className="truncate">{labels.group(g)}</span>
                <HealthCounts g={g} labels={labels} />
              </>
            ) : (
              <>
                {node.namespace && <span className="truncate rounded px-1 py-px bg-black/5 dark:bg-white/5">{node.namespace}</span>}
                {node.subtype && node.subtype !== 'http' && <span className="shrink-0 rounded px-1 py-px bg-black/5 dark:bg-white/5">{node.subtype}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-0.5 font-medium" style={{ color: healthTone }}>
                  <HealthIcon health={node.health} className="h-3 w-3" />
                  <span>{labels.health[node.health] ?? node.health}</span>
                </span>
              </>
            )}
          </div>
          <div className="mt-auto">
            <div className="relative h-[18px] rounded-md overflow-hidden bg-black/5 dark:bg-white/[0.04]">
              {bar > 0 && (
                <div className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-700"
                  style={{ width: `${bar * 100}%`, background: `linear-gradient(90deg, color-mix(in oklab, var(${CLASS_VAR[cls]}) 18%, transparent), color-mix(in oklab, var(${CLASS_VAR[cls]}) 45%, transparent))` }} />
              )}
              {/* One line whatever the font: the rate and error always show,
                  the latency gives way when the row runs out of room. */}
              <div className="relative flex h-full items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 font-mono text-[10px] tabular-nums" style={{ color: 'var(--sm-text)' }}>
                {traffic ? (
                  <>
                    <span className="shrink-0 font-semibold">{fmtRps(s.rps)} {labels.rps}</span>
                    {!s.rateOnly && <span className="min-w-0 truncate" style={{ color: 'var(--sm-text-2)' }}>{fmtMs(s.p95Ms)}</span>}
                    {!s.rateOnly && (
                      <span className="ml-auto shrink-0" style={{ color: s.errorRate >= 0.05 ? 'var(--sm-crit)' : s.errorRate >= 0.01 ? 'var(--sm-warn)' : 'var(--sm-text-2)' }}>
                        {fmtPct(s.errorRate)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="truncate" style={{ color: 'var(--sm-text-2)' }}>{node.replicas ? `${node.replicas} · ` : ''}{labels.noTraffic}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ServiceNodeCard = memo(ServiceNodeCardImpl);
