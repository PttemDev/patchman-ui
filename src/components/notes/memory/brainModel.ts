import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3';
import type { MemoryGraph, MemoryGraphNode, NoteLinkType } from '@/types';

// The Brain's data model: the memory graph turned into simulation nodes and
// three kinds of edges — the tree (card → project → memory: the "axons"),
// the typed links between notes, and synapses (one per pair of projects whose
// cards link to each other, weighted by how many links cross).

export interface BrainNode extends SimulationNodeDatum, MemoryGraphNode {
  r: number;
  color: string;
  degree: number;
  /** Projects: how many cards orbit it. */
  size: number;
  /** The project node this node belongs to (a project's own id for itself). */
  hub?: string;
}

export interface BrainEdge extends SimulationLinkDatum<BrainNode> {
  kind: 'tree' | 'link' | 'synapse';
  type?: NoteLinkType;
  cross?: boolean;
  weight: number;
  source: BrainNode;
  target: BrainNode;
}

export interface BrainModel {
  nodes: BrainNode[];
  byId: Map<string, BrainNode>;
  tree: BrainEdge[];
  links: BrainEdge[];
  synapses: BrainEdge[];
  neighbors: Map<string, Set<string>>;
  projects: BrainNode[];
}

export const LINK_COLORS: Record<NoteLinkType, string> = {
  depends_on: '#f59e0b',
  part_of: '#a78bfa',
  contradicts: '#f43f5e',
  supersedes: '#ef4444',
  example_of: '#34d399',
  related: '#60a5fa',
  refers_to: '#22d3ee',
};

/** Twelve hues far enough apart to tell projects apart at a glance. */
const PROJECT_HUES = [190, 38, 150, 320, 260, 85, 15, 210, 345, 170, 55, 285];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A colour per project: each takes the hue its name hashes to, or the next
 *  free one — so a handful of projects never share a colour, and a project
 *  keeps its colour as others come and go (mostly). */
export function projectColors(projects: { id: string; title: string }[], dark: boolean): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<number>();
  for (const p of [...projects].sort((a, b) => a.title.localeCompare(b.title))) {
    let slot = hash(p.title.toLowerCase()) % PROJECT_HUES.length;
    for (let i = 0; i < PROJECT_HUES.length && taken.has(slot); i++) slot = (slot + 1) % PROJECT_HUES.length;
    taken.add(slot);
    const hue = PROJECT_HUES[slot] + (taken.size > PROJECT_HUES.length ? (hash(p.id) % 20) - 10 : 0);
    out.set(p.id, dark ? `hsl(${hue} 88% 62%)` : `hsl(${hue} 75% 40%)`);
  }
  return out;
}

export function buildBrain(g: MemoryGraph, dark: boolean): BrainModel {
  const byId = new Map<string, BrainNode>();
  const degree = new Map<string, number>();
  for (const l of g.links) {
    degree.set(l.src, (degree.get(l.src) ?? 0) + 1);
    degree.set(l.dst, (degree.get(l.dst) ?? 0) + 1);
  }
  const cardsIn = new Map<string, number>();
  for (const n of g.nodes) if (n.kind === 'card' && n.project) cardsIn.set(n.project, (cardsIn.get(n.project) ?? 0) + 1);

  const neutral = dark ? 'hsl(262 85% 72%)' : 'hsl(262 70% 50%)';
  const colors = projectColors(g.nodes.filter((n) => n.kind === 'project'), dark);
  const nodes: BrainNode[] = g.nodes.map((n) => {
    const d = degree.get(n.id) ?? 0;
    let r = 4;
    let color = neutral;
    if (n.project) color = colors.get(n.project) ?? neutral;
    switch (n.kind) {
      case 'memory':
        r = 26;
        break;
      case 'project':
        r = 13 + Math.sqrt(cardsIn.get(n.id) ?? 0) * 2.2;
        break;
      case 'card':
        r = 3.6 + Math.min(4, Math.sqrt(d) * 1.1 + Math.log1p(n.uses ?? 0) * 0.6);
        break;
      case 'folder':
        r = 7;
        color = dark ? 'hsl(43 96% 56%)' : 'hsl(38 92% 45%)'; // the folder icon's amber
        break;
      case 'page':
        r = 5;
        color = dark ? 'hsl(215 16% 62%)' : 'hsl(215 16% 42%)';
        break;
      case 'entity':
        r = 4.5;
        color = LINK_COLORS.refers_to;
        break;
    }
    const b: BrainNode = { ...n, r, color, degree: d, hub: n.project, size: n.kind === 'project' ? cardsIn.get(n.id) ?? 0 : 0 };
    byId.set(n.id, b);
    return b;
  });

  const tree: BrainEdge[] = [];
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent && n.kind !== 'memory') tree.push({ kind: 'tree', source: n, target: parent, weight: 1 });
  }

  const neighbors = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a)!.add(b);
  };
  const links: BrainEdge[] = [];
  const synapseCount = new Map<string, number>();
  for (const l of g.links) {
    const s = byId.get(l.src);
    const t = byId.get(l.dst);
    if (!s || !t || s === t) continue;
    const cross = !!s.hub && !!t.hub && s.hub !== t.hub;
    links.push({ kind: 'link', type: l.type, source: s, target: t, cross, weight: 1 });
    touch(s.id, t.id);
    touch(t.id, s.id);
    if (cross) {
      const key = [s.hub, t.hub].sort().join('|');
      synapseCount.set(key, (synapseCount.get(key) ?? 0) + 1);
    }
  }
  const synapses: BrainEdge[] = [];
  for (const [key, count] of synapseCount) {
    const [a, b] = key.split('|');
    const s = byId.get(a);
    const t = byId.get(b);
    if (s && t) synapses.push({ kind: 'synapse', source: s, target: t, weight: count });
  }
  return { nodes, byId, tree, links, synapses, neighbors, projects: nodes.filter((n) => n.kind === 'project') };
}
