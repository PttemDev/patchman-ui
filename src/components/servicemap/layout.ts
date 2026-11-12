import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3';
import type { ServiceMapGraph } from '@/types';
import { NODE_H, NODE_W } from './serviceMapUtil';

// Layered, top-down layout: callers above callees (Ingress → services →
// queues → databases), ordered within a layer by the barycenter heuristic,
// then relaxed with d3-force so the map reads organically without overlaps.
// Positions that already exist (a refresh) are kept; only new nodes move in.
// Big maps stay screen-shaped: wide layers wrap into rows, long call chains
// fall back to shortest-path layers, and nodes cluster by namespace.

export const LAYER_GAP = 190;
export const COL_GAP = NODE_W + 56;
const ROW_GAP = NODE_H + 48;
/** Vertical stretch while simulating (card width : height). */
const SY = NODE_W / NODE_H;
/** Deeper longest-path layerings than this switch to shortest paths. */
const MAX_LAYERS = 8;

interface SimNode extends SimulationNodeDatum {
  id: string;
  layer: number;
  tx: number;
  ty: number;
}

export type Positions = Map<string, { x: number; y: number }>;

function layers(g: ServiceMapGraph): Map<string, number> {
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of g.nodes) {
    out.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of g.edges) {
    // Consumers read FROM a broker but still call it: keep them above it.
    if (!out.has(e.from) || !out.has(e.to) || e.from === e.to) continue;
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const depth = new Map<string, number>();
  // Longest path from the roots, cycle-safe (a node is placed once per
  // visit stack; back edges are ignored).
  const visiting = new Set<string>();
  const visit = (id: string, d: number) => {
    if (visiting.has(id)) return;
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    visiting.add(id);
    for (const nx of out.get(id) ?? []) visit(nx, d + 1);
    visiting.delete(id);
  };
  const roots = g.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0 || n.kind === 'ingress').map((n) => n.id);
  for (const r of roots) visit(r, 0);
  for (const n of g.nodes) if (!depth.has(n.id)) visit(n.id, 0);
  const deepest = Math.max(0, ...g.nodes.filter((n) => n.kind === 'service').map((n) => depth.get(n.id) ?? 0));
  if (deepest > MAX_LAYERS) {
    // Cyclic, chatty graphs make one long chain; hops from the entry points
    // keep the map wide instead of a tower of near-empty layers.
    depth.clear();
    const queue = [...roots];
    for (const r of roots) depth.set(r, 0);
    const bfs = () => {
      while (queue.length) {
        const cur = queue.shift()!;
        for (const nx of out.get(cur) ?? []) {
          if (depth.has(nx)) continue;
          depth.set(nx, depth.get(cur)! + 1);
          queue.push(nx);
        }
      }
    };
    bfs();
    for (const n of g.nodes) {
      if (depth.has(n.id)) continue;
      depth.set(n.id, 0);
      queue.push(n.id);
      bfs();
    }
  }
  // Data stores sink to the bottom band, queues just above them.
  const maxSvc = Math.max(0, ...g.nodes.filter((n) => n.kind === 'service' || n.kind === 'ingress').map((n) => depth.get(n.id) ?? 0));
  for (const n of g.nodes) {
    const d = depth.get(n.id) ?? 0;
    if (n.kind === 'messaging') depth.set(n.id, Math.max(d, maxSvc + 1));
    if (n.kind === 'datastore') depth.set(n.id, Math.max(d, maxSvc + 2));
    if (n.kind === 'ingress') depth.set(n.id, 0);
  }
  return depth;
}

export function computeLayout(g: ServiceMapGraph, previous?: Positions): Positions {
  const depth = layers(g);
  const byLayer = new Map<number, string[]>();
  for (const n of g.nodes) {
    const d = depth.get(n.id) ?? 0;
    (byLayer.get(d) ?? byLayer.set(d, []).get(d)!).push(n.id);
  }
  const order = [...byLayer.keys()].sort((a, b) => a - b);
  const nb = new Map<string, string[]>();
  for (const e of g.edges) {
    (nb.get(e.from) ?? nb.set(e.from, []).get(e.from)!).push(e.to);
    (nb.get(e.to) ?? nb.set(e.to, []).get(e.to)!).push(e.from);
  }
  // Big maps cluster by namespace inside each layer, so a namespace reads
  // as one column band; small ones order purely to untangle crossings.
  const clustered = g.nodes.length > 60;
  const nsOf = new Map(g.nodes.map((n) => [n.id, n.namespace ?? '\uffff']));
  const nsRank = new Map([...new Set([...nsOf.values()])].sort().map((ns, i) => [ns, i]));
  const rank = (id: string) => (clustered ? nsRank.get(nsOf.get(id)!)! * 1e6 : 0);
  for (const l of order) byLayer.get(l)!.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const pos = new Map<string, number>();
  const place = () => {
    for (const l of order) byLayer.get(l)!.forEach((id, i) => pos.set(id, i));
  };
  place();
  // Barycenter sweeps (down then up) to untangle crossings.
  for (let pass = 0; pass < 4; pass++) {
    const seq = pass % 2 === 0 ? order : [...order].reverse();
    for (const l of seq) {
      const ids = byLayer.get(l)!;
      const bc = new Map(ids.map((id) => {
        const ns = (nb.get(id) ?? []).filter((x) => (depth.get(x) ?? 0) !== l);
        return [id, rank(id) + (ns.length ? ns.reduce((s, x) => s + (pos.get(x) ?? 0), 0) / ns.length : pos.get(id) ?? 0)] as const;
      }));
      ids.sort((a, b) => bc.get(a)! - bc.get(b)!);
      ids.forEach((id, i) => pos.set(id, i));
    }
  }
  // Wrap wide layers so the whole map stays roughly screen-shaped.
  const cols = Math.max(10, Math.ceil(Math.sqrt(g.nodes.length * 1.3)));
  const widest = Math.min(cols, Math.max(1, ...order.map((l) => byLayer.get(l)!.length)));
  const sim: SimNode[] = [];
  let y = 0;
  for (const l of order) {
    const ids = byLayer.get(l)!;
    const rows = Math.ceil(ids.length / cols);
    for (let r = 0; r < rows; r++) {
      const row = ids.slice(r * cols, (r + 1) * cols);
      const offset = ((widest - row.length) * COL_GAP) / 2;
      row.forEach((id, i) => {
        const tx = offset + i * COL_GAP;
        const ty = (y + r * ROW_GAP) * SY;
        const prev = previous?.get(id);
        sim.push({ id, layer: l, tx, ty, x: prev?.x ?? tx, y: prev ? prev.y * SY : ty, ...(prev ? { fx: prev.x, fy: prev.y * SY } : {}) });
      });
    }
    y += (rows - 1) * ROW_GAP + LAYER_GAP;
  }
  // Keep the already-placed nodes fixed while new ones settle around them.
  // The simulation runs with y stretched so the wide cards collide as
  // circles of their width.
  const simulation = forceSimulation(sim)
    .force('x', forceX<SimNode>((d) => d.tx).strength(0.25))
    .force('y', forceY<SimNode>((d) => d.ty).strength(0.9))
    .force('collide', forceCollide<SimNode>(NODE_W / 2 + 8).strength(0.9))
    .stop();
  for (let i = 0; i < 160; i++) simulation.tick();
  const out: Positions = new Map();
  for (const n of sim) out.set(n.id, { x: Math.round(n.x ?? n.tx), y: Math.round((n.y ?? n.ty) / SY) });
  return out;
}
