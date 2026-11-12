import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, useReactFlow, applyNodeChanges,
  type NodeChange, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ServiceMapGraph } from '@/types';
import { ServiceNodeCard, type CardData, type CardNode } from './ServiceNodeCard';
import { FlowEdge, type FlowEdgeType } from './FlowEdge';
import { computeLayout, type Positions } from './layout';
import { ParticleEngine, type FlowEdgeSpec, type MotionMode } from './particles';
import { NODE_H, NODE_W, edgeLanes, hasTraffic, pathOf, DENSE_NODES, HEALTH_VAR } from './serviceMapUtil';

const sameData = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  for (const k in b) if (a[k] !== b[k]) return false;
  return true;
};

const nodeTypes = { svc: ServiceNodeCard };
const edgeTypes = { flow: FlowEdge };

export interface CanvasProps {
  graph: ServiceMapGraph;
  selectedNode: string | null;
  selectedEdge: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  newIds: Set<string>;
  motion: MotionMode;
  /** The tab is visible: the particle layer runs only then. */
  active: boolean;
  labels: CardData['labels'];
  fitSignal: number;
  /** Big map: cheaper rendering, selection-only one-hop highlight. */
  dense: boolean;
  /** Context nodes (outside the chosen namespaces), drawn faded. */
  context: Set<string>;
  /** Changes when the view's shape changes (filters, grouping, focus): the
   *  map is laid out afresh and refitted instead of keeping old spots. */
  layoutKey: string;
  onOpenGroup: (id: string) => void;
}

function CanvasInner(p: CanvasProps) {
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const [engine, setEngine] = useState<ParticleEngine | null>(null);
  const rfRef = useRef(rf);
  rfRef.current = rf;
  const posRef = useRef<Positions>(new Map());
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const fitted = useRef(false);
  const layoutKeyRef = useRef(p.layoutKey);
  const edgeCache = useRef(new Map<string, FlowEdgeType>());

  // Layout: keep known positions, place new nodes around them — unless the
  // view itself changed, then start over and refit.
  useEffect(() => {
    if (layoutKeyRef.current !== p.layoutKey) {
      layoutKeyRef.current = p.layoutKey;
      posRef.current = new Map();
      fitted.current = false;
    }
    const keep: Positions = new Map();
    for (const n of p.graph.nodes) {
      const prev = posRef.current.get(n.id);
      if (prev) keep.set(n.id, prev);
    }
    posRef.current = computeLayout(p.graph, keep);
    if (!fitted.current && p.graph.nodes.length > 0) {
      fitted.current = true;
      requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 600 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.graph, p.layoutKey]);

  useEffect(() => {
    if (p.graph.nodes.length > DENSE_NODES) setHover(null);
  }, [p.graph]);

  useEffect(() => {
    if (p.fitSignal > 0) rf.fitView({ padding: 0.15, duration: 500 });
  }, [p.fitSignal, rf]);

  // Hover previews the path on small maps only: on a dense one every hover
  // would repaint hundreds of cards.
  const hoverable = p.graph.nodes.length <= DENSE_NODES;
  // A selection the view does not draw (picked from a call list) dims nothing.
  const drawnSelection = p.selectedNode && p.graph.nodes.some((n) => n.id === p.selectedNode) ? p.selectedNode : null;
  const focus = drawnSelection ?? (hoverable ? hover : null);
  const path = useMemo(() => (focus ? pathOf(p.graph, focus, p.dense ? 1 : Infinity) : null), [p.graph, focus, p.dense]);
  const edgeFocus = useMemo(() => {
    if (!p.selectedEdge) return null;
    const e = p.graph.edges.find((x) => x.id === p.selectedEdge);
    return e ? { nodes: new Set([e.from, e.to]), edges: new Set([e.id]) } : null;
  }, [p.graph, p.selectedEdge]);
  const hl = edgeFocus ?? path;
  const maxRps = useMemo(() => Math.max(0, ...p.graph.nodes.map((n) => (n.stats.hasRed ? n.stats.rps : 0))), [p.graph]);

  // Unchanged cards keep their object so React Flow skips them.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return p.graph.nodes.map((n) => {
        const position = posRef.current.get(n.id) ?? { x: 0, y: 0 };
        const data: CardData = {
          node: n,
          selected: n.id === p.selectedNode,
          dim: !!hl && !hl.nodes.has(n.id),
          faint: p.context.has(n.id),
          isNew: p.newIds.has(n.id),
          maxRps,
          labels: p.labels,
        };
        const old = byId.get(n.id);
        if (old && old.position.x === position.x && old.position.y === position.y && sameData(old.data, data)) return old;
        return { id: n.id, type: 'svc' as const, position, width: NODE_W, height: NODE_H, data };
      });
    });
  }, [p.graph, p.selectedNode, hl, p.newIds, maxRps, p.labels, p.context, p.layoutKey]);

  // Rates on the links of the focused path (all links only on small maps).
  const fewEdges = p.graph.edges.length <= 12;
  const lanes = useMemo(() => edgeLanes(p.graph.edges), [p.graph]);
  const edges: FlowEdgeType[] = useMemo(() => {
    const prev = edgeCache.current;
    const next = new Map<string, FlowEdgeType>();
    const list = p.graph.edges.map((e) => {
      const highlight = !!hl && hl.edges.has(e.id);
      const width = e.stats.hasRed && e.stats.rps > 0 ? 1.2 + Math.min(4.5, Math.log10(1 + e.stats.rps) * 1.6) : hasTraffic(e.stats) ? 1.2 : 1;
      const data = { edge: e, dim: !!hl && !highlight, highlight, showLabel: highlight || (!hl && fewEdges), width, rpsLabel: p.labels.rps, dense: p.dense, lane: lanes.get(e.id) ?? 0 };
      const old = prev.get(e.id);
      const out: FlowEdgeType = old && old.source === e.from && old.target === e.to && old.data && sameData(old.data, data)
        ? old
        : { id: e.id, source: e.from, target: e.to, type: 'flow' as const, selectable: true, data };
      next.set(e.id, out);
      return out;
    });
    edgeCache.current = next;
    return list;
  }, [p.graph, hl, fewEdges, p.labels.rps, p.dense, lanes]);

  // ── Particle layer ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const eng = new ParticleEngine(canvas);
    engineRef.current = eng;
    setEngine(eng);
    const ro = new ResizeObserver(() => eng.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    eng.resize(wrap.clientWidth, wrap.clientHeight);
    eng.setViewport(rfRef.current.getViewport());
    // Theme switches restyle the canvas colours.
    const mo = new MutationObserver(() => eng.readColors());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    (window as unknown as { __smEngine?: ParticleEngine }).__smEngine = eng;
    return () => {
      ro.disconnect();
      mo.disconnect();
      eng.destroy();
      engineRef.current = null;
      setEngine(null);
    };
  }, []);

  // Geometry and rates only: dimming goes through setDim, so a selection
  // does not rebuild every curve.
  const specs = useCallback((list: CardNode[]): FlowEdgeSpec[] => {
    const pos = new Map(list.map((n) => [n.id, n.position]));
    const out: FlowEdgeSpec[] = [];
    for (const e of p.graph.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b || !hasTraffic(e.stats)) continue;
      out.push({
        id: e.id,
        sx: a.x + NODE_W / 2, sy: a.y + NODE_H, tx: b.x + NODE_W / 2, ty: b.y,
        rps: e.stats.hasRed ? e.stats.rps : 0,
        errorRate: e.stats.errorRate ?? 0,
        p95Ms: e.stats.p95Ms ?? 0,
        rateOnly: !!e.stats.rateOnly,
        conns: e.stats.conns ?? 0,
        protocol: e.protocol,
        reverse: e.flow === 'consume',
        lane: lanes.get(e.id) ?? 0,
      });
    }
    return out;
  }, [p.graph, lanes]);

  useEffect(() => {
    engine?.setEdges(specs(nodes));
  }, [engine, nodes, specs]);

  useEffect(() => {
    engine?.setDim(hl ? hl.edges : null);
  }, [engine, hl]);

  useEffect(() => {
    if (!engine) return;
    engine.mode = p.motion;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const run = () => {
      if (p.motion !== 'off' && p.active && !reduced && !document.hidden) engine.start();
      else {
        engine.stop();
        engine.clear();
      }
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [engine, p.motion, p.active]);

  const onMove = useCallback((_: unknown, v: Viewport) => engineRef.current?.setViewport(v), []);

  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((ns) => {
      const next = applyNodeChanges(changes, ns);
      for (const c of changes) {
        if (c.type === 'position' && c.position) posRef.current.set(c.id, c.position);
      }
      return next;
    });
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full sm-stage overflow-hidden">
      <div className="sm-grid-floor" />
      {/* Below the cards: particles slip under the glass as they arrive. */}
      <canvas ref={canvasRef} data-testid="sm-particles" className="pointer-events-none absolute inset-0" />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onMove={onMove}
        onNodeClick={(_, n) => { p.onSelectEdge(null); p.onSelectNode(n.id === p.selectedNode ? null : n.id); }}
        onNodeDoubleClick={(_, n) => { if ((n.data as CardData).node.group) p.onOpenGroup(n.id); }}
        zoomOnDoubleClick={false}
        onlyRenderVisibleElements={p.dense}
        onEdgeClick={(_, e) => { p.onSelectNode(null); p.onSelectEdge(e.id === p.selectedEdge ? null : e.id); }}
        onPaneClick={() => { p.onSelectNode(null); p.onSelectEdge(null); }}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.08}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--sm-grid)" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => `var(${HEALTH_VAR[(n.data as CardData).node.health] ?? '--sm-unknown'})`}
          nodeStrokeWidth={0}
          maskStrokeColor="var(--sm-accent)"
          className="!rounded-lg !border !border-[var(--sm-card-border)]"
        />
        <Controls showInteractive={false} className="!rounded-lg !overflow-hidden !shadow-none" />
      </ReactFlow>
    </div>
  );
}

export function ServiceMapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
