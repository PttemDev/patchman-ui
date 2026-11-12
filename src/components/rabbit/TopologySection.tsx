import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Search, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rabbitAPI, type DBScope } from '@/services/api';
import { rabbitError } from '@/stores/rabbitConnectionStore';
import type { RabbitBinding, RabbitConnection, RabbitExchange, RabbitQueue } from '@/types';
import { ErrorBanner, Loading } from './RabbitUI';
import { fmtNum, openRabbitExchange, openRabbitQueue } from './rabbitUtil';

// Routing topology of a vhost as a layered graph: exchanges on the left
// (exchange-to-exchange bindings push the target one column right), queues
// on the right, edges labelled with the routing key. Dead-lettering is drawn
// as a dashed red edge from a queue back to its dead-letter exchange.

interface TopoData { exchanges: RabbitExchange[]; queues: RabbitQueue[]; bindings: RabbitBinding[] }

interface GNode { id: string; kind: 'exchange' | 'queue'; name: string; type?: string; col: number; row: number; x: number; y: number; w: number; messages?: number; consumers?: number; internal?: boolean }
interface GEdge { from: string; to: string; label: string; kind: 'binding' | 'dlx' }

const NODE_H = 34;
const ROW_GAP = 12;
const COL_GAP = 150;
const EX_W = 200;
const Q_W = 230;
const PAD = 24;

function layout(data: TopoData, showSystem: boolean, focus: string): { nodes: GNode[]; edges: GEdge[]; width: number; height: number } {
  const exByName = new Map(data.exchanges.map((e) => [e.name, e]));
  const edges: GEdge[] = [];
  for (const b of data.bindings) {
    if (!b.source) continue; // implicit default-exchange bindings
    edges.push({ from: `e:${b.source}`, to: `${b.destination_type === 'exchange' ? 'e' : 'q'}:${b.destination}`, label: b.routing_key, kind: 'binding' });
  }
  for (const q of data.queues) {
    const dlx = q.arguments?.['x-dead-letter-exchange'];
    if (typeof dlx === 'string' && dlx && exByName.has(dlx)) edges.push({ from: `q:${q.name}`, to: `e:${dlx}`, label: String(q.arguments?.['x-dead-letter-routing-key'] ?? ''), kind: 'dlx' });
  }
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  let ids = new Set<string>();
  for (const e of data.exchanges) {
    if (!e.name) continue;
    const system = e.name.startsWith('amq.');
    if (system && !showSystem && !linked.has(`e:${e.name}`)) continue;
    ids.add(`e:${e.name}`);
  }
  for (const q of data.queues) ids.add(`q:${q.name}`);
  // Focus: matching nodes and their direct neighbours.
  const f = focus.trim().toLowerCase();
  if (f) {
    const hit = new Set([...ids].filter((id) => id.slice(2).toLowerCase().includes(f)));
    const keep = new Set(hit);
    for (const e of edges) {
      if (hit.has(e.from)) keep.add(e.to);
      if (hit.has(e.to)) keep.add(e.from);
    }
    ids = new Set([...ids].filter((id) => keep.has(id)));
  }
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  // Exchange depth from exchange→exchange bindings (cycle-safe).
  const depth = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const e of live) if (e.kind === 'binding' && e.to.startsWith('e:')) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const d = Math.max(0, ...(incoming.get(id) ?? []).map((s) => visit(s, stack) + 1));
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  const exIds = [...ids].filter((id) => id.startsWith('e:'));
  exIds.forEach((id) => visit(id, new Set()));
  const qCol = Math.max(0, ...exIds.map((id) => depth.get(id) ?? 0)) + 1;

  const cols: string[][] = [];
  for (const id of [...ids].sort()) {
    const c = id.startsWith('q:') ? qCol : depth.get(id) ?? 0;
    (cols[c] ??= []).push(id);
  }
  // Barycenter ordering (two sweeps) to keep edges from crossing.
  const pos = new Map<string, number>();
  const index = () => cols.forEach((col) => col?.forEach((id, i) => pos.set(id, i)));
  index();
  const preds = (id: string) => live.filter((e) => e.kind === 'binding' && e.to === id).map((e) => pos.get(e.from) ?? 0);
  const succs = (id: string) => live.filter((e) => e.kind === 'binding' && e.from === id).map((e) => pos.get(e.to) ?? 0);
  const avg = (xs: number[], fallback: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback);
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 1; c < cols.length; c++) {
      cols[c]?.sort((a, b) => avg(preds(a), pos.get(a)!) - avg(preds(b), pos.get(b)!));
      index();
    }
    for (let c = cols.length - 2; c >= 0; c--) {
      cols[c]?.sort((a, b) => avg(succs(a), pos.get(a)!) - avg(succs(b), pos.get(b)!));
      index();
    }
  }

  const qByName = new Map(data.queues.map((q) => [q.name, q]));
  const nodes: GNode[] = [];
  let x = PAD;
  let maxRows = 0;
  cols.forEach((col, c) => {
    if (!col) return;
    const w = c === qCol ? Q_W : EX_W;
    maxRows = Math.max(maxRows, col.length);
    col.forEach((id, r) => {
      const name = id.slice(2);
      const q = id.startsWith('q:') ? qByName.get(name) : undefined;
      const e = id.startsWith('e:') ? exByName.get(name) : undefined;
      nodes.push({
        id, kind: q ? 'queue' : 'exchange', name, type: q?.type ?? e?.type, col: c, row: r, x, y: PAD + r * (NODE_H + ROW_GAP), w,
        messages: q?.messages, consumers: q?.consumers, internal: e?.internal,
      });
    });
    x += w + COL_GAP;
  });
  // Vertically center shorter columns.
  const fullH = maxRows * (NODE_H + ROW_GAP);
  for (const col of cols) {
    if (!col) continue;
    const offset = (fullH - col.length * (NODE_H + ROW_GAP)) / 2;
    for (const n of nodes) if (col.includes(n.id)) n.y += offset;
  }
  return { nodes, edges: live, width: x - COL_GAP + PAD, height: fullH + PAD * 2 + 40 };
}

function bezier(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number): [number, number] {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [f(0), f(1)];
}

const EX_FILL: Record<string, string> = { topic: '#8b5cf6', fanout: '#ec4899', direct: '#3b82f6', headers: '#14b8a6' };

export function TopologySection({ conn, scope, vhost, tick }: { conn: RabbitConnection; scope: DBScope; vhost: string; tick: number }) {
  const { t } = useTranslation('rabbit');
  const [data, setData] = useState<TopoData | null>(null);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await rabbitAPI.topology(conn.id, vhost, scope);
      const d = res.data as TopoData;
      setData({ exchanges: d.exchanges ?? [], queues: d.queues ?? [], bindings: d.bindings ?? [] });
      setError('');
    } catch (e) {
      setError(rabbitError(e).message);
    }
  }, [conn.id, scope, vhost]);
  useEffect(() => { void load(); }, [load, tick]);

  const g = useMemo(() => (data ? layout(data, showSystem, focus) : null), [data, showSystem, focus]);
  const byId = useMemo(() => new Map((g?.nodes ?? []).map((n) => [n.id, n])), [g]);
  const related = useMemo(() => {
    if (!hover || !g) return null;
    const s = new Set<string>([hover]);
    for (const e of g.edges) {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    }
    return s;
  }, [hover, g]);
  const showLabels = (g?.edges.length ?? 0) <= 160;

  return (
    <div className="h-full flex flex-col min-h-0 p-3 gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={t('topology.focus')} className="h-7 text-xs pl-7" />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> {t('exchanges.showSystem')}
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Legend />
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}><Minus className="h-3.5 w-3.5" /></Button>
          <span className="text-[11px] tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}><Plus className="h-3.5 w-3.5" /></Button>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(1)} title="100%"><Maximize className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      {error && !data ? <ErrorBanner message={error} onRetry={load} /> : !g ? <Loading /> : g.nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{t('topology.empty')}</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-md border bg-card">
          <svg width={g.width * zoom} height={g.height * zoom} viewBox={`0 0 ${g.width} ${g.height}`} className="block select-none">
            <defs>
              <marker id="rmq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-muted-foreground" />
              </marker>
              <marker id="rmq-arrow-dlx" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
              </marker>
            </defs>
            {g.edges.map((e, i) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const dim = related && !(related.has(e.from) && related.has(e.to));
              const dlx = e.kind === 'dlx';
              const p0: [number, number] = dlx ? [a.x, a.y + NODE_H / 2] : [a.x + a.w, a.y + NODE_H / 2];
              const p3: [number, number] = dlx ? [b.x + b.w, b.y + NODE_H / 2 + 6] : [b.x - 2, b.y + NODE_H / 2];
              const p1: [number, number] = dlx ? [p0[0] - 70, p0[1] + 50] : [p0[0] + 70, p0[1]];
              const p2: [number, number] = dlx ? [p3[0] + 70, p3[1] + 50] : [p3[0] - 70, p3[1]];
              const d = `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
              // Labels sit near the target end, where edges fan apart.
              const [lx, ly] = bezier(p0, p1, p2, p3, dlx ? 0.5 : 0.78);
              const focused = related && related.has(e.from) && related.has(e.to);
              return (
                <g key={i} opacity={dim ? 0.12 : dlx && !focused ? 0.45 : 1}>
                  <path
                    d={d}
                    fill="none"
                    stroke={e.kind === 'dlx' ? '#ef4444' : 'currentColor'}
                    className={e.kind === 'dlx' ? undefined : 'text-muted-foreground/60'}
                    strokeWidth={1.3}
                    strokeDasharray={e.kind === 'dlx' ? '5 4' : undefined}
                    markerEnd={e.kind === 'dlx' ? 'url(#rmq-arrow-dlx)' : 'url(#rmq-arrow)'}
                  />
                  {(showLabels || related) && (e.label || e.kind === 'dlx') && (
                    <text x={lx} y={ly - 3} textAnchor="middle" fontSize={10} className="fill-foreground" style={{ paintOrder: 'stroke', stroke: 'var(--color-card)', strokeWidth: 3 }}>
                      {e.kind === 'dlx' ? `DLX ${e.label}`.trim() : e.label.length > 28 ? `${e.label.slice(0, 27)}…` : e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {g.nodes.map((n) => {
              const dim = related && !related.has(n.id);
              const isQ = n.kind === 'queue';
              const stuck = isQ && n.type !== 'stream' && (n.messages ?? 0) > 0 && (n.consumers ?? 0) === 0;
              const accent = isQ ? (n.type === 'quorum' ? '#10b981' : n.type === 'stream' ? '#0ea5e9' : '#f97316') : EX_FILL[n.type ?? ''] ?? '#64748b';
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  opacity={dim ? 0.25 : 1}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => (isQ ? openRabbitQueue(conn.id, vhost, n.name) : openRabbitExchange(conn.id, vhost, n.name))}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{`${isQ ? t('bindings.queue') : t('bindings.exchange')} ${n.name} (${n.type ?? ''})${isQ ? ` · ${n.messages ?? 0} msgs · ${n.consumers ?? 0} consumers` : ''}`}</title>
                  <rect width={n.w} height={NODE_H} rx={isQ ? 4 : 17} className="fill-card" stroke={stuck ? '#f59e0b' : accent} strokeWidth={hover === n.id ? 2.2 : 1.4} strokeDasharray={n.internal ? '4 3' : undefined} />
                  <rect width={6} height={NODE_H} rx={isQ ? 2 : 3} fill={accent} x={isQ ? 0 : 6} />
                  <text x={isQ ? 14 : 18} y={14} fontSize={11} fontWeight={600} className="fill-foreground">{n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name}</text>
                  <text x={isQ ? 14 : 18} y={27} fontSize={9.5} className="fill-muted-foreground">
                    {isQ ? `${n.type ?? 'classic'} · ${fmtNum(n.messages ?? 0)} msg · ${fmtNum(n.consumers ?? 0)} cons` : `${n.type}${n.internal ? ' · internal' : ''}`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

function Legend() {
  const { t } = useTranslation('rabbit');
  return (
    <div className="hidden md:flex items-center gap-2 mr-2 text-[10px] text-muted-foreground">
      {Object.entries(EX_FILL).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k}</span>)}
      <span className="flex items-center gap-1"><span className="h-0 w-4 border-t border-dashed border-red-500" />{t('topology.deadLetter')}</span>
    </div>
  );
}
