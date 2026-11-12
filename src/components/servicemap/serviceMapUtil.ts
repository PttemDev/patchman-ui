import type { ServiceMapEdge, ServiceMapGraph, ServiceMapNode, ServiceMapNodeKind, ServiceMapStats } from '@/types';

// Shared, React-free helpers of the service map: protocol classes and
// colours, edge geometry (used by both the SVG edges and the particle
// canvas so they line up exactly), number formatting and Mermaid export.

export const NODE_W = 232;
export const NODE_H = 96;

export type ProtoClass = 'http' | 'data' | 'msg';

const DATA = new Set(['postgres', 'mysql', 'mssql', 'mongo', 'redis', 'elasticsearch', 'memcached', 'cassandra', 'clickhouse', 's3', 'zookeeper', 'db', 'prometheus']);
const MSG = new Set(['amqp', 'rabbitmq', 'kafka', 'nats', 'messaging', 'queue']);

export function protoClass(protocol?: string): ProtoClass {
  const p = (protocol ?? '').toLowerCase();
  if (DATA.has(p)) return 'data';
  if (MSG.has(p)) return 'msg';
  return 'http';
}

export function nodeClass(n: Pick<ServiceMapNode, 'kind' | 'subtype'>): ProtoClass {
  if (n.kind === 'datastore') return 'data';
  if (n.kind === 'messaging') return 'msg';
  return 'http';
}

export const HEALTH_VAR: Record<string, string> = { ok: '--sm-ok', warning: '--sm-warn', critical: '--sm-crit', unknown: '--sm-unknown' };

/** CSS variable per protocol class (resolved by the canvas at runtime). */
export const CLASS_VAR: Record<ProtoClass, string> = { http: '--sm-http', data: '--sm-data', msg: '--sm-msg' };

// ── Geometry ─────────────────────────────────────────────────────────
export interface Pt { x: number; y: number }
export interface Bezier { p0: Pt; p1: Pt; p2: Pt; p3: Pt }

const LANE_GAP = 14;

/** One curve per edge, from the source's bottom centre to the target's top
 *  centre; edges that go up (cycles, consumers above their broker) swing out
 *  to the side so they never cut through cards. Parallel links between the
 *  same two nodes (`lane` ≠ 0) fan out side by side instead of overlapping. */
export function edgeBezier(sx: number, sy: number, tx: number, ty: number, lane = 0): Bezier {
  const off = lane * LANE_GAP;
  const p0 = { x: sx + off, y: sy };
  const p3 = { x: tx + off, y: ty };
  if (ty >= sy + 24) {
    const dy = Math.max(40, (ty - sy) * 0.5);
    return { p0, p1: { x: sx + off * 3, y: sy + dy }, p2: { x: tx + off * 3, y: ty - dy }, p3 };
  }
  // Going up: leave below the source, swing past the cards on one side and
  // come down onto the target — never straight through the cards between.
  const side = tx >= sx ? 1 : -1;
  const reach = NODE_W * 0.85 + Math.abs(tx - sx) * 0.15;
  return { p0, p1: { x: sx + side * reach + off * 3, y: sy + 140 }, p2: { x: tx + side * reach + off * 3, y: ty - 140 }, p3 };
}

/** Where along its curve a link's label sits: parallel links stagger theirs. */
export function labelT(lane: number): number {
  return Math.min(0.8, Math.max(0.2, 0.5 + lane * 0.24));
}

/** Lane of every link that shares its two nodes with another (centred on 0). */
export function edgeLanes(edges: ServiceMapEdge[]): Map<string, number> {
  const pairs = new Map<string, string[]>();
  for (const e of edges) {
    const k = e.from < e.to ? `${e.from}\n${e.to}` : `${e.to}\n${e.from}`;
    (pairs.get(k) ?? pairs.set(k, []).get(k)!).push(e.id);
  }
  const out = new Map<string, number>();
  for (const ids of pairs.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    ids.forEach((id, i) => out.set(id, i - (ids.length - 1) / 2));
  }
  return out;
}

export function bezierPath(b: Bezier): string {
  return `M${b.p0.x},${b.p0.y} C${b.p1.x},${b.p1.y} ${b.p2.x},${b.p2.y} ${b.p3.x},${b.p3.y}`;
}

export function bezierPoint(b: Bezier, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, c = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * b.p0.x + c * b.p1.x + d * b.p2.x + e * b.p3.x, y: a * b.p0.y + c * b.p1.y + d * b.p2.y + e * b.p3.y };
}

/** Arc-length table so particles move at constant speed along a curve. */
export function arcTable(b: Bezier, steps = 48): { len: number; ts: Float32Array; ds: Float32Array } {
  const ts = new Float32Array(steps + 1);
  const ds = new Float32Array(steps + 1);
  let prev = b.p0;
  let len = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = bezierPoint(b, t);
    if (i > 0) len += Math.hypot(p.x - prev.x, p.y - prev.y);
    ts[i] = t;
    ds[i] = len;
    prev = p;
  }
  return { len, ts, ds };
}

/** t for a fraction of the curve's length. */
export function tAt(table: { len: number; ts: Float32Array; ds: Float32Array }, frac: number): number {
  const target = frac * table.len;
  const { ds, ts } = table;
  let lo = 0, hi = ds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ds[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  const d0 = ds[lo - 1], d1 = ds[lo];
  const f = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
  return ts[lo - 1] + f * (ts[lo] - ts[lo - 1]);
}

// ── Formatting ───────────────────────────────────────────────────────
export function fmtRps(v?: number): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (v < 0.01) return '<0.01';
  if (v < 10) return v.toFixed(2);
  if (v < 1000) return v.toFixed(1);
  return `${(v / 1000).toFixed(1)}k`;
}

export function fmtMs(v?: number): string {
  if (!v || !Number.isFinite(v)) return '—';
  if (v < 1) return `${Math.round(v * 1000)}µs`;
  if (v < 1000) return `${v < 10 ? v.toFixed(1) : Math.round(v)}ms`;
  return `${(v / 1000).toFixed(v < 10_000 ? 2 : 1)}s`;
}

export function fmtPct(v?: number): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const p = v * 100;
  if (p === 0) return '0%';
  if (p < 0.1) return '<0.1%';
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

export function hasTraffic(s: ServiceMapStats): boolean {
  return Boolean(s.hasRed && s.rps > 0) || (s.conns ?? 0) > 0;
}

export function errorKnown(s: ServiceMapStats): boolean {
  return Boolean(s.hasRed && !s.rateOnly);
}

/** Same rule as the BE (and Coroot): only "failed", 5xx and non-OK gRPC
 *  codes are errors; Linkerd labels its errors "failure". */
export function isErrorStatus(status: string): boolean {
  return status === 'failed' || status === 'failure' || status.startsWith('5') || (status.startsWith('grpc:') && status !== 'grpc:OK');
}

// ── Graph helpers ────────────────────────────────────────────────────
export const SYSTEM_CATEGORIES = new Set(['monitoring', 'control-plane']);
export const NODE_KINDS: ServiceMapNodeKind[] = ['service', 'datastore', 'messaging', 'external', 'ingress'];

/** Above this many nodes or links the map is "dense": flat cards instead of
 *  glass (a backdrop blur re-renders whatever moves beneath it), one-hop
 *  highlight paths, no hover preview above DENSE_NODES. */
export const DENSE_NODES = 120;
export const DENSE_EDGES = 150;
/** Above this many nodes namespaces fold up unless the user chose. */
export const GROUP_AUTO = 80;

export interface MapFilters {
  hideSystem: boolean;
  onlyErrors: boolean;
  hideIsolated: boolean;
  /** Drop links seen only in configuration (no observed traffic). */
  trafficOnly: boolean;
  hiddenKinds: ServiceMapNodeKind[];
  search: string;
}

export function matchesSearch(n: ServiceMapNode, q: string): boolean {
  return `${n.namespace ?? ''}/${n.name} ${n.subtype ?? ''}`.toLowerCase().includes(q);
}

/** Applies the toolbar filters; a search keeps matches and their neighbours. */
export function filterGraph(g: ServiceMapGraph, f: MapFilters): ServiceMapGraph {
  let nodes = g.nodes;
  if (f.hideSystem) nodes = nodes.filter((n) => !SYSTEM_CATEGORIES.has(n.category ?? ''));
  if (f.hiddenKinds.length) nodes = nodes.filter((n) => !f.hiddenKinds.includes(n.kind));
  const ids = new Set(nodes.map((n) => n.id));
  let edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  if (f.trafficOnly) edges = edges.filter((e) => hasTraffic(e.stats));
  if (f.onlyErrors) {
    edges = edges.filter((e) => errorKnown(e.stats) && e.stats.errorRate >= 0.01 || !!e.issue);
    const keep = new Set(edges.flatMap((e) => [e.from, e.to]));
    nodes = nodes.filter((n) => keep.has(n.id) || n.health === 'critical');
  }
  const q = f.search.trim().toLowerCase();
  if (q) {
    const hit = new Set(nodes.filter((n) => matchesSearch(n, q)).map((n) => n.id));
    for (const e of edges) {
      if (hit.has(e.from) || hit.has(e.to)) {
        hit.add(e.from);
        hit.add(e.to);
      }
    }
    nodes = nodes.filter((n) => hit.has(n.id));
    edges = edges.filter((e) => hit.has(e.from) && hit.has(e.to));
  }
  if (f.hideIsolated) {
    const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
    nodes = nodes.filter((n) => linked.has(n.id));
  }
  const final = new Set(nodes.map((n) => n.id));
  return { ...g, nodes, edges: edges.filter((e) => final.has(e.from) && final.has(e.to)) };
}

export interface NamespaceInfo {
  namespace: string;
  nodes: number;
  critical: number;
  warning: number;
}

/** Namespaces on a map with their node counts ('' = outside any namespace). */
export function namespacesOf(g: ServiceMapGraph): NamespaceInfo[] {
  const m = new Map<string, NamespaceInfo>();
  for (const n of g.nodes) {
    const ns = n.namespace ?? '';
    const cur = m.get(ns) ?? { namespace: ns, nodes: 0, critical: 0, warning: 0 };
    cur.nodes++;
    if (n.health === 'critical') cur.critical++;
    if (n.health === 'warning') cur.warning++;
    m.set(ns, cur);
  }
  return [...m.values()].sort((a, b) => (a.namespace === '' ? 1 : b.namespace === '' ? -1 : a.namespace.localeCompare(b.namespace)));
}

/** Keeps the chosen namespaces plus, as faded context, whatever they call or
 *  are called by elsewhere — a namespace on its own would be an island. */
export function scopeNamespaces(g: ServiceMapGraph, selected?: string[]): { graph: ServiceMapGraph; context: Set<string> } {
  const context = new Set<string>();
  if (!selected?.length) return { graph: g, context };
  const keep = new Set(selected);
  const inside = new Set(g.nodes.filter((n) => keep.has(n.namespace ?? '')).map((n) => n.id));
  const edges = g.edges.filter((e) => inside.has(e.from) || inside.has(e.to));
  for (const e of edges) {
    if (!inside.has(e.from)) context.add(e.from);
    if (!inside.has(e.to)) context.add(e.to);
  }
  return { graph: { ...g, nodes: g.nodes.filter((n) => inside.has(n.id) || context.has(n.id)), edges }, context };
}

export const groupId = (ns: string) => `ns:${ns || '~'}`;

const HEALTH_RANK: Record<string, number> = { critical: 3, warning: 2, ok: 1, unknown: 0 };

type Acc = { rps: number; err: number; errRps: number; p95: number; conns: number; red: boolean; known: boolean; statuses: Record<string, number> };

function addStats(acc: Acc, s: ServiceMapStats) {
  for (const [k, v] of Object.entries(s.statuses ?? {})) acc.statuses[k] = (acc.statuses[k] ?? 0) + v;
  if (s.hasRed) {
    acc.red = true;
    acc.rps += s.rps;
    if (errorKnown(s)) {
      acc.known = true;
      acc.err += s.rps * s.errorRate;
      acc.errRps += s.rps;
      acc.p95 = Math.max(acc.p95, s.p95Ms ?? 0);
    }
  }
  acc.conns += s.conns ?? 0;
}

function finishStats(acc: Acc): ServiceMapStats {
  return {
    statuses: Object.keys(acc.statuses).length ? acc.statuses : undefined,
    rps: acc.rps,
    errorRate: acc.errRps > 0 ? acc.err / acc.errRps : 0,
    p95Ms: acc.p95 || undefined,
    conns: acc.conns || undefined,
    hasRed: acc.red || undefined,
    rateOnly: acc.red && !acc.known ? true : undefined,
  };
}

const newAcc = (): Acc => ({ rps: 0, err: 0, errRps: 0, p95: 0, conns: 0, red: false, known: false, statuses: {} });

/** Folds every namespace not in `expanded` into one node, and the calls
 *  between namespaces into one link per direction, flow and protocol class
 *  (rates summed, errors rate-weighted, the worst p95). */
export function groupByNamespace(g: ServiceMapGraph, expanded: Set<string>, outsideLabel: string): ServiceMapGraph {
  const members = new Map<string, ServiceMapNode[]>();
  for (const n of g.nodes) {
    const ns = n.namespace ?? '';
    if (expanded.has(ns)) continue;
    (members.get(ns) ?? members.set(ns, []).get(ns)!).push(n);
  }
  const owner = new Map<string, string>();
  const nodes: ServiceMapNode[] = [];
  for (const n of g.nodes) owner.set(n.id, n.id);
  for (const [ns, list] of members) {
    // A namespace of one is clearer as itself.
    if (list.length < 2) continue;
    const id = groupId(ns);
    const acc = newAcc();
    const health: Record<string, number> = {};
    const kinds: Record<string, number> = {};
    let worst = 'unknown';
    const sources = new Set<string>();
    for (const m of list) {
      owner.set(m.id, id);
      addStats(acc, m.stats);
      health[m.health] = (health[m.health] ?? 0) + 1;
      kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
      if (HEALTH_RANK[m.health] > HEALTH_RANK[worst]) worst = m.health;
      m.sources.forEach((s) => sources.add(s));
    }
    const only = Object.keys(kinds);
    nodes.push({
      id,
      kind: only.length === 1 ? (only[0] as ServiceMapNodeKind) : ns ? 'service' : 'external',
      namespace: ns || undefined,
      name: ns || outsideLabel,
      health: worst as ServiceMapNode['health'],
      stats: finishStats(acc),
      sources: [...sources],
      group: { namespace: ns, members: list.length, health, kinds },
    });
  }
  const folded = new Set(nodes.map((n) => n.id));
  const out = [...g.nodes.filter((n) => owner.get(n.id) === n.id), ...nodes];
  const edges: ServiceMapEdge[] = [];
  const agg = new Map<string, { e: ServiceMapEdge; acc: ReturnType<typeof newAcc>; best: number; sources: Set<string> }>();
  for (const e of g.edges) {
    const a = owner.get(e.from) ?? e.from;
    const b = owner.get(e.to) ?? e.to;
    if (a === b) continue;
    if (!folded.has(a) && !folded.has(b)) {
      edges.push(e);
      continue;
    }
    const key = `${a}>${b}|${e.flow}|${protoClass(e.protocol)}`;
    let cur = agg.get(key);
    if (!cur) {
      cur = { e: { id: `agg:${key}`, from: a, to: b, flow: e.flow, protocol: e.protocol, sources: [], stats: { rps: 0, errorRate: 0 }, calls: 0 }, acc: newAcc(), best: -1, sources: new Set() };
      agg.set(key, cur);
    }
    addStats(cur.acc, e.stats);
    cur.e.calls = (cur.e.calls ?? 0) + 1;
    if (!cur.e.issue && e.issue) cur.e.issue = e.issue;
    const r = e.stats.hasRed ? e.stats.rps : 0;
    if (r > cur.best) {
      cur.best = r;
      cur.e.protocol = e.protocol;
    }
    e.sources.forEach((s) => cur!.sources.add(s));
  }
  for (const { e, acc, sources } of agg.values()) {
    // Every call behind it vanished: the folded link is a ghost too.
    const gone = sources.size === 1 && sources.has('gone');
    edges.push({ ...e, sources: [...sources], stats: gone ? { rps: 0, errorRate: 0 } : finishStats(acc) });
  }
  return { ...g, nodes: out, edges };
}

/** Members of a folded namespace node. */
export function membersOf(g: ServiceMapGraph, group: ServiceMapNode): ServiceMapNode[] {
  if (!group.group) return [];
  const ns = group.group.namespace;
  return g.nodes.filter((n) => (n.namespace ?? '') === ns);
}

/** Only what lies within `depth` hops of a node, in either direction. */
export function neighbourhood(g: ServiceMapGraph, id: string, depth: number): ServiceMapGraph | null {
  if (!g.nodes.some((n) => n.id === id)) return null;
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
  }
  const keep = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

/** Upstream and downstream of a node (the highlighted path), up to `maxHops`
 *  away — on dense maps the full closure would light up everything. */
export function pathOf(g: ServiceMapGraph, id: string, maxHops = Infinity): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  const out = new Map<string, ServiceMapEdge[]>();
  const inn = new Map<string, ServiceMapEdge[]>();
  for (const e of g.edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
  }
  const walk = (start: string, adj: Map<string, ServiceMapEdge[]>, next: (e: ServiceMapEdge) => string) => {
    let frontier = [start];
    const seen = new Set([start]);
    for (let hop = 0; hop < maxHops && frontier.length; hop++) {
      const nextFrontier: string[] = [];
      for (const cur of frontier) {
        for (const e of adj.get(cur) ?? []) {
          edges.add(e.id);
          const n = next(e);
          nodes.add(n);
          if (!seen.has(n)) {
            seen.add(n);
            nextFrontier.push(n);
          }
        }
      }
      frontier = nextFrontier;
    }
  };
  walk(id, out, (e) => e.to);
  walk(id, inn, (e) => e.from);
  return { nodes, edges };
}

export function totals(g: ServiceMapGraph): { rps: number; errorRate: number; observed: number } {
  let rps = 0, err = 0, observed = 0;
  for (const e of g.edges) {
    if (!e.stats.hasRed) continue;
    observed++;
    rps += e.stats.rps;
    if (!e.stats.rateOnly) err += e.stats.rps * e.stats.errorRate;
  }
  return { rps, errorRate: rps > 0 ? err / rps : 0, observed };
}

// ── Mermaid export (whiteboard) ──────────────────────────────────────
const esc = (s: string) => s.replace(/["[\]{}()<>|#;]/g, ' ').replace(/\s+/g, ' ').trim();

export function toMermaid(g: ServiceMapGraph, maxNodes = 120): string {
  const nodes = g.nodes.slice(0, maxNodes);
  const idx = new Map(nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = ['flowchart TD'];
  for (const n of nodes) {
    const label = esc(n.namespace ? `${n.name} · ${n.namespace}` : n.name) || n.id;
    const id = idx.get(n.id)!;
    if (n.kind === 'datastore') lines.push(`  ${id}[("${label}")]`);
    else if (n.kind === 'messaging') lines.push(`  ${id}{{"${label}"}}`);
    else if (n.kind === 'external') lines.push(`  ${id}(("${label}"))`);
    else if (n.kind === 'ingress') lines.push(`  ${id}>"${label}"]`);
    else lines.push(`  ${id}["${label}"]`);
  }
  for (const e of g.edges) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (!a || !b) continue;
    const parts: string[] = [];
    if (e.protocol && e.protocol !== 'http') parts.push(e.protocol);
    if (e.stats.hasRed) parts.push(`${fmtRps(e.stats.rps)} rps`);
    if (errorKnown(e.stats) && e.stats.errorRate >= 0.01) parts.push(`${fmtPct(e.stats.errorRate)} err`);
    const label = parts.length ? `|${esc(parts.join(' · '))}|` : '';
    const arrow = hasTraffic(e.stats) ? '-->' : '-.->';
    lines.push(e.flow === 'consume' ? `  ${b} ${arrow}${label} ${a}` : `  ${a} ${arrow}${label} ${b}`);
  }
  return lines.join('\n');
}
