import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, quadtree, select, zoom, zoomIdentity,
  type Simulation, type ZoomBehavior, type ZoomTransform,
} from 'd3';
import { Loader2, Maximize2, Pause, Play, RefreshCw, Search, X } from 'lucide-react';
import { notesAPI } from '@/services/api';
import { useMemoryStore } from '@/stores/memoryStore';
import { cn } from '@/lib/utils';
import type { MemoryGraph, NoteLinkType } from '@/types';
import { openNoteTab } from '../useOpenNote';
import { formatWhen } from '../time';
import { buildBrain, LINK_COLORS, type BrainEdge, type BrainModel, type BrainNode } from './brainModel';

// MemoryBrain draws agent memory as a living brain: the memory is the core,
// each project a glowing hub, cards orbit their project, and typed links run
// between them with signals travelling along — brightest where knowledge
// crosses from one project to another (the synapses between hubs).
//
// Canvas + d3-force rather than DOM nodes, so thousands of cards stay smooth.
// Hover lights up a card's neighbourhood; click opens it; drag, wheel-zoom
// and pan move around. prefers-reduced-motion (or the pause button) stops the
// signals and the breathing glow.

const ALL_TYPES: NoteLinkType[] = ['depends_on', 'part_of', 'related', 'example_of', 'contradicts', 'supersedes', 'refers_to'];

interface Signal {
  e: BrainEdge;
  t: number;
  speed: number;
}

function isDark() {
  return document.documentElement.classList.contains('dark');
}

export default function MemoryBrain({ rootId, rootLabel }: { rootId?: string; rootLabel?: string }) {
  const { t, i18n } = useTranslation('notes');
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(!rootId);
  const [query, setQuery] = useState('');
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<NoteLinkType>>(new Set());
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const [paused, setPaused] = useState(reduced);
  const [hover, setHover] = useState<{ node: BrainNode; x: number; y: number } | null>(null);
  const [dark, setDark] = useState(isDark);
  const cardsTotal = useMemoryStore((s) => s.folders.reduce((n, f) => n + f.cards, 0));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notesAPI.memoryGraph(all ? undefined : rootId);
      setGraph(res.data as MemoryGraph);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [all, rootId]);

  // Reload when the scope changes or cards come and go (note events refresh
  // the memory store).
  useEffect(() => { void load(); }, [load, cardsTotal]);

  // Follow the app theme.
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  const model = useMemo<BrainModel | null>(() => (graph ? buildBrain(graph, dark) : null), [graph, dark]);

  // Everything the draw loop reads lives in refs, so the loop never restarts.
  const view = useRef({
    transform: zoomIdentity as ZoomTransform,
    hoverId: '' as string,
    highlight: null as Set<string> | null,
    match: null as Set<string> | null,
    hiddenProjects: new Set<string>(),
    hiddenTypes: new Set<NoteLinkType>(),
    paused: false,
    dark: false,
    signals: [] as Signal[],
  });
  view.current.hiddenProjects = hiddenProjects;
  view.current.hiddenTypes = hiddenTypes;
  view.current.paused = paused;
  view.current.dark = dark;

  // Search: matching nodes stay lit, the rest dim.
  useEffect(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!model || !q) {
      view.current.match = null;
      return;
    }
    const m = new Set<string>();
    for (const n of model.nodes) {
      if (n.title.toLocaleLowerCase().includes(q) || (n.summary ?? '').toLocaleLowerCase().includes(q)) m.add(n.id);
    }
    view.current.match = m;
  }, [query, model]);

  const simRef = useRef<Simulation<BrainNode, BrainEdge> | null>(null);
  // Positions survive a reload (another agent adding a card must not
  // reshuffle the brain); the view is fitted once per scope.
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const fittedFor = useRef('');
  const lastInteract = useRef(performance.now());
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);

  const visible = useCallback((n: BrainNode) => !(n.hub && view.current.hiddenProjects.has(n.hub)), []);

  const fit = useCallback((ids?: Set<string>, duration = 700) => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !zoomRef.current) return;
    const pts = model.nodes.filter((n) => (ids ? ids.has(n.id) : visible(n)) && n.x !== undefined);
    if (pts.length === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of pts) {
      x0 = Math.min(x0, n.x! - n.r); y0 = Math.min(y0, n.y! - n.r);
      x1 = Math.max(x1, n.x! + n.r); y1 = Math.max(y1, n.y! + n.r);
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const k = Math.min(4, 0.86 / Math.max((x1 - x0) / w, (y1 - y0) / h, 1e-3));
    const tr = zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    select(canvas).transition().duration(duration).call(zoomRef.current.transform, tr);
  }, [model, visible]);

  // Simulation + zoom + pointer handling, once per model.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model) return;
    const big = model.nodes.length > 1500;
    // One memory: it is the core, pinned at the centre with its projects around it.
    const memories = model.nodes.filter((n) => n.kind === 'memory');
    if (memories.length === 1) { memories[0].fx = 0; memories[0].fy = 0; }
    // Known nodes keep their place; a new one starts beside its parent.
    let known = 0;
    for (const n of model.nodes) {
      const p = posRef.current.get(n.id);
      if (p) { n.x = p.x; n.y = p.y; known++; }
    }
    for (const n of model.nodes) {
      if (posRef.current.has(n.id)) continue;
      const parent = n.parentId ? posRef.current.get(n.parentId) : undefined;
      if (parent) { n.x = parent.x + (Math.random() - 0.5) * 40; n.y = parent.y + (Math.random() - 0.5) * 40; }
    }
    const warm = known > model.nodes.length / 2;
    const sim = forceSimulation<BrainNode>(model.nodes)
      // A big project spreads its cards over a wider disc instead of a tight ring.
      .force('tree', forceLink<BrainNode, BrainEdge>(model.tree)
        .distance((e) => (e.target.kind === 'memory' ? 220 + Math.sqrt(e.source.size) * 14 : 26 + Math.sqrt(e.target.size) * 11 * (0.55 + Math.random() * 0.6)))
        .strength((e) => (e.target.kind === 'memory' ? 0.25 : 0.32)))
      .force('links', forceLink<BrainNode, BrainEdge>(model.links).distance((e) => (e.cross ? 160 : 55)).strength((e) => (e.cross ? 0.012 : 0.05)))
      .force('synapse', forceLink<BrainNode, BrainEdge>(model.synapses).distance(260).strength(0.02))
      .force('charge', forceManyBody<BrainNode>().strength((n) => (n.kind === 'memory' ? -900 : n.kind === 'project' ? -520 : -42)).distanceMax(700))
      .force('collide', forceCollide<BrainNode>().radius((n) => n.r + 3.5))
      .force('x', forceX<BrainNode>(0).strength(0.02))
      .force('y', forceY<BrainNode>(0).strength(0.02))
      .alphaDecay(big ? 0.04 : 0.022)
      .stop();
    // Settle the worst of it off-screen, then let it breathe into place
    // (a reload with known positions only nudges the newcomers in).
    if (warm) sim.alpha(0.12);
    else sim.tick(big ? 40 : 60);
    sim.restart();
    simRef.current = sim;

    // Signals: one per typed link (several on busy synapses).
    const signals: Signal[] = [];
    for (const e of model.links) signals.push({ e, t: Math.random(), speed: 0.12 + Math.random() * 0.1 });
    for (const e of model.synapses) {
      for (let i = 0; i < Math.min(6, 1 + Math.round(Math.log2(1 + e.weight))); i++) signals.push({ e, t: Math.random(), speed: 0.08 + Math.random() * 0.06 });
    }
    // A big brain keeps a sample of signals: the eye reads flow, not counts.
    view.current.signals = big ? signals.filter((_, i) => i % Math.ceil(signals.length / 500) === 0) : signals.slice(0, 1500);

    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.08, 8])
      .filter((ev: Event) => !(ev.type === 'mousedown' && dragging.current))
      .on('zoom', (ev) => { view.current.transform = ev.transform; lastInteract.current = performance.now(); });
    zoomRef.current = z;
    select(canvas).call(z).on('dblclick.zoom', null);
    // Fit once per scope — marked done only when it actually ran (a dev
    // double-mount cancels the first frame).
    const scopeKey = all ? 'all' : rootId ?? '';
    let fitFrame = 0;
    if (fittedFor.current !== scopeKey) {
      fitFrame = requestAnimationFrame(() => { fittedFor.current = scopeKey; fit(undefined, 0); });
    } else {
      select(canvas).call(z.transform, view.current.transform); // keep the user's zoom
    }
    const positions = posRef.current;
    return () => {
      cancelAnimationFrame(fitFrame);
      sim.stop();
      select(canvas).on('.zoom', null);
      for (const n of model.nodes) if (n.x !== undefined && n.y !== undefined) positions.set(n.id, { x: n.x, y: n.y });
    };
  }, [model, fit, all, rootId]);

  // Hit-testing in graph coordinates; the quadtree is rebuilt at most every
  // 120 ms (nodes drift while the layout settles), not on every pointer move.
  const qtRef = useRef<{ at: number; tree: ReturnType<typeof quadtree<BrainNode>> } | null>(null);
  const nodeAt = useCallback((px: number, py: number): BrainNode | null => {
    if (!model) return null;
    const tr = view.current.transform;
    const [gx, gy] = tr.invert([px, py]);
    const now = performance.now();
    if (!qtRef.current || now - qtRef.current.at > 120) {
      qtRef.current = { at: now, tree: quadtree<BrainNode>().x((n) => n.x ?? 0).y((n) => n.y ?? 0).addAll(model.nodes.filter(visible)) };
    }
    const qt = qtRef.current.tree;
    const n = qt.find(gx, gy, 24 / tr.k);
    if (!n) return null;
    const d = Math.hypot((n.x ?? 0) - gx, (n.y ?? 0) - gy);
    return d <= n.r + 6 / tr.k ? n : null;
  }, [model, visible]);

  const dragging = useRef<BrainNode | null>(null);
  const moved = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    moved.current = false;
    if (n) {
      dragging.current = n;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      simRef.current?.alphaTarget(0.15).restart();
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    lastInteract.current = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const d = dragging.current;
    if (d) {
      const [gx, gy] = view.current.transform.invert([px, py]);
      d.fx = gx; d.fy = gy;
      moved.current = true;
      return;
    }
    const n = nodeAt(px, py);
    const id = n?.id ?? '';
    if (id !== view.current.hoverId) {
      view.current.hoverId = id;
      view.current.highlight = n && model ? litAround(model, n) : null;
      e.currentTarget.style.cursor = n ? 'pointer' : 'grab';
    }
    setHover(n ? { node: n, x: px, y: py } : null);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragging.current;
    dragging.current = null;
    simRef.current?.alphaTarget(0);
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    d.fx = null; d.fy = null;
    if (moved.current) return;
    if (d.kind === 'card' || d.kind === 'page' || d.kind === 'folder') openNoteTab(d.id, d.title);
    else if (d.kind === 'project' && model) fit(new Set(model.nodes.filter((n) => n.hub === d.id).map((n) => n.id)));
    else if (d.kind === 'memory') fit();
  };

  // The draw loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !model) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let w = 0, h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = wrap.clientWidth; h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const small = model.nodes.length <= 600;
    // Background stars, fixed per mount.
    const stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2, p: Math.random() * Math.PI * 2 }));

    let skip = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      // Idle (layout settled, nobody touching it): 30 fps is plenty.
      const idle = (simRef.current?.alpha() ?? 0) < 0.03 && !view.current.hoverId && !dragging.current && now - lastInteract.current > 4000;
      skip = idle && !skip;
      if (skip) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = view.current;
      const dk = v.dark;
      const tr = v.transform;
      const time = now / 1000;
      const breathe = v.paused ? 0 : Math.sin(time * 1.6);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Background: deep space (dark) or a soft paper glow (light).
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
      if (dk) { bg.addColorStop(0, '#0f1028'); bg.addColorStop(1, '#05060f'); } else { bg.addColorStop(0, '#fbfaff'); bg.addColorStop(1, '#ece9f7'); }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const a = (dk ? 0.5 : 0.18) * (0.6 + 0.4 * Math.sin(time * 0.7 + s.p) * (v.paused ? 0 : 1));
        ctx.fillStyle = dk ? `rgba(200,210,255,${a})` : `rgba(90,80,160,${a})`;
        ctx.beginPath();
        ctx.arc(((s.x * w + tr.x * 0.05) % w + w) % w, ((s.y * h + tr.y * 0.05) % h + h) % h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.scale(tr.k, tr.k);
      const lit = v.highlight ?? v.match;
      const shown = (n: BrainNode) => !(n.hub && v.hiddenProjects.has(n.hub));
      const alphaOf = (n: BrainNode) => (lit ? (lit.has(n.id) ? 1 : 0.12) : n.stale ? 0.45 : 1);

      // Axons: the tree — one path for the dim ones, one for the lit ones.
      ctx.lineWidth = 1 / tr.k;
      const axDim = new Path2D(), axLit = new Path2D();
      for (const e of model.tree) {
        const s = e.source, t2 = e.target;
        if (!shown(s) || !shown(t2)) continue;
        const path = lit && lit.has(s.id) && lit.has(t2.id) ? axLit : axDim;
        path.moveTo(s.x!, s.y!);
        path.lineTo(t2.x!, t2.y!);
      }
      ctx.strokeStyle = dk ? `rgba(160,150,255,${lit ? 0.04 : 0.15})` : `rgba(90,70,170,${lit ? 0.04 : 0.15})`;
      ctx.stroke(axDim);
      if (lit) {
        ctx.strokeStyle = dk ? 'rgba(160,150,255,0.5)' : 'rgba(90,70,170,0.5)';
        ctx.stroke(axLit);
      }
      // Synapses: glowing arcs between projects that share knowledge.
      for (const e of model.synapses) {
        if (!shown(e.source) || !shown(e.target)) continue;
        const [cx, cy] = bend(e, 0.22);
        const a = lit ? (lit.has(e.source.id) || lit.has(e.target.id) ? 0.9 : 0.1) : 0.55;
        ctx.save();
        ctx.shadowColor = dk ? 'rgba(236,72,153,0.9)' : 'rgba(190,24,93,0.6)';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = dk ? `rgba(244,114,182,${a})` : `rgba(190,24,93,${a * 0.8})`;
        ctx.lineWidth = (1.5 + Math.log2(1 + e.weight) * 1.4) / Math.sqrt(tr.k);
        ctx.beginPath();
        ctx.moveTo(e.source.x!, e.source.y!);
        ctx.quadraticCurveTo(cx, cy, e.target.x!, e.target.y!);
        ctx.stroke();
        ctx.restore();
      }
      // Typed links: one path per (type, crossing, lit) bucket.
      const buckets = new Map<string, Path2D>();
      for (const e of model.links) {
        if (!e.type || v.hiddenTypes.has(e.type) || !shown(e.source) || !shown(e.target)) continue;
        const on = lit ? lit.has(e.source.id) && lit.has(e.target.id) : true;
        const key = `${e.type}|${e.cross ? 1 : 0}|${on ? 1 : 0}`;
        let path = buckets.get(key);
        if (!path) buckets.set(key, (path = new Path2D()));
        const [cx, cy] = bend(e, e.cross ? 0.18 : 0.1);
        path.moveTo(e.source.x!, e.source.y!);
        path.quadraticCurveTo(cx, cy, e.target.x!, e.target.y!);
      }
      const dense = model.links.length > 1500;
      for (const [key, path] of buckets) {
        const [type, cross, on] = key.split('|');
        ctx.strokeStyle = hexA(LINK_COLORS[type as NoteLinkType], on === '1' ? (cross === '1' ? 0.75 : dense ? 0.18 : 0.42) : 0.05);
        ctx.lineWidth = (cross === '1' ? 1.6 : 1) / Math.sqrt(tr.k);
        ctx.stroke(path);
      }
      // Signals travelling along links and synapses (pre-rendered glow sprites).
      if (!v.paused) {
        ctx.save();
        ctx.globalCompositeOperation = dk ? 'lighter' : 'source-over';
        for (const s of v.signals) {
          const e = s.e;
          if (e.type && v.hiddenTypes.has(e.type)) continue;
          if (!shown(e.source) || !shown(e.target)) continue;
          if (lit && !(lit.has(e.source.id) || lit.has(e.target.id))) continue;
          s.t = (s.t + s.speed * dt) % 1;
          const [cx, cy] = bend(e, e.kind === 'synapse' ? 0.22 : e.cross ? 0.18 : 0.1);
          const p = quad(e.source.x!, e.source.y!, cx, cy, e.target.x!, e.target.y!, s.t);
          const col = e.kind === 'synapse' ? (dk ? '#f9a8d4' : '#be185d') : LINK_COLORS[e.type!];
          const rad = ((e.kind === 'synapse' ? 3.2 : 2.2) / Math.sqrt(tr.k)) * 3;
          ctx.drawImage(glowSprite(col), p[0] - rad, p[1] - rad, rad * 2, rad * 2);
        }
        ctx.restore();
      }
      // Nodes. Hubs, pages and entities one by one (few); cards batched per
      // colour and alpha into one path each.
      const cardFill = new Map<string, Path2D>();
      const cardRing = new Map<string, Path2D>();
      const human = new Path2D();
      let hovered: BrainNode | null = null;
      for (const n of model.nodes) {
        if (!shown(n)) continue;
        const a = alphaOf(n);
        if (n.kind === 'card') {
          if (n.id === v.hoverId) { hovered = n; continue; }
          const key = `${n.color}|${a}`;
          const map = n.stale ? cardRing : cardFill;
          let path = map.get(key);
          if (!path) map.set(key, (path = new Path2D()));
          path.moveTo(n.x! + n.r, n.y!);
          path.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
          if (n.source === 'human' && a > 0.5) { human.moveTo(n.x! + n.r, n.y!); human.arc(n.x!, n.y!, n.r, 0, Math.PI * 2); }
          continue;
        }
        ctx.globalAlpha = a;
        if (n.kind === 'memory' || n.kind === 'project') {
          const pulse = n.kind === 'memory' ? 1 + 0.06 * breathe : 1 + 0.03 * breathe;
          const R = n.r * pulse;
          const halo = ctx.createRadialGradient(n.x!, n.y!, R * 0.2, n.x!, n.y!, R * (n.kind === 'memory' ? 3.2 : 2.6));
          halo.addColorStop(0, withAlpha(n.color, dk ? 0.55 : 0.35));
          halo.addColorStop(1, withAlpha(n.color, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, R * (n.kind === 'memory' ? 3.2 : 2.6), 0, Math.PI * 2);
          ctx.fill();
          const core = ctx.createRadialGradient(n.x! - R * 0.3, n.y! - R * 0.3, R * 0.1, n.x!, n.y!, R);
          core.addColorStop(0, dk ? '#ffffff' : withAlpha(n.color, 0.35));
          core.addColorStop(1, n.color);
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, R, 0, Math.PI * 2);
          ctx.fill();
          if (n.kind === 'memory') {
            ctx.strokeStyle = withAlpha(n.color, 0.5);
            ctx.lineWidth = 1.5 / tr.k;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, R * (1.5 + 0.15 * breathe), 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (n.kind === 'entity') {
          ctx.fillStyle = n.color;
          ctx.beginPath();
          ctx.moveTo(n.x!, n.y! - n.r); ctx.lineTo(n.x! + n.r, n.y!); ctx.lineTo(n.x!, n.y! + n.r); ctx.lineTo(n.x! - n.r, n.y!);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = n.color;
          const s = n.r * 1.6;
          ctx.beginPath();
          ctx.roundRect(n.x! - s / 2, n.y! - s / 2, s, s, 2);
          ctx.fill();
        }
      }
      for (const [key, path] of cardFill) {
        const [color, a] = key.split('|');
        ctx.globalAlpha = Number(a);
        // Glow per card only while it is cheap (shadowBlur blurs each draw).
        if (dk && small && Number(a) > 0.5) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
        ctx.fillStyle = color;
        ctx.fill(path);
        ctx.shadowBlur = 0;
      }
      ctx.lineWidth = 1.2 / tr.k;
      for (const [key, path] of cardRing) {
        const [color, a] = key.split('|');
        ctx.globalAlpha = Number(a);
        ctx.strokeStyle = color;
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = dk ? 'rgba(255,255,255,0.85)' : 'rgba(30,30,40,0.8)';
      ctx.stroke(human);
      if (hovered) {
        ctx.shadowColor = hovered.color;
        ctx.shadowBlur = dk ? 22 : 0;
        ctx.fillStyle = hovered.color;
        ctx.beginPath();
        ctx.arc(hovered.x!, hovered.y!, hovered.r * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      // Labels: hubs always, cards when zoomed in or lit.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of model.nodes) {
        if (!shown(n)) continue;
        const hub = n.kind === 'memory' || n.kind === 'project' || n.kind === 'folder';
        const litNode = (lit && lit.has(n.id) && lit.size < 40) || n.id === v.hoverId;
        if (!hub && !(tr.k > 1.7 || litNode)) continue;
        if (lit && !lit.has(n.id) && !hub) continue;
        const size = hub ? (n.kind === 'memory' ? 15 : n.kind === 'folder' ? 11 : 12.5) : 10.5;
        ctx.font = `${hub ? 650 : 500} ${size / Math.sqrt(tr.k)}px Inter, ui-sans-serif, system-ui`;
        const text = n.title.length > 38 && !hub ? n.title.slice(0, 36) + '…' : n.title;
        const y = n.y! + n.r * (n.kind === 'memory' ? 1.7 : 1.25) + 3 / tr.k;
        ctx.globalAlpha = hub ? Math.max(0.35, alphaOf(n)) : alphaOf(n);
        ctx.lineWidth = 3 / tr.k;
        ctx.strokeStyle = dk ? 'rgba(5,6,15,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.strokeText(text, n.x!, y);
        ctx.fillStyle = dk ? (hub ? '#f5f3ff' : 'rgba(226,232,255,0.92)') : hub ? '#1e1b4b' : 'rgba(30,27,75,0.9)';
        ctx.fillText(text, n.x!, y);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [model]);

  const stats = useMemo(() => {
    if (!model) return null;
    return {
      cards: model.nodes.filter((n) => n.kind === 'card').length,
      projects: model.projects.length,
      links: model.links.length,
      crossing: model.links.filter((l) => l.cross).length,
    };
  }, [model]);

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  };

  const hv = hover?.node;
  return (
    <div ref={wrapRef} className="relative flex-1 min-h-[420px] overflow-hidden rounded-lg border bg-background" data-testid="memory-brain">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={stats ? t('memory.brain.aria', { cards: stats.cards, projects: stats.projects, links: stats.links }) : t('memory.brain.title')}
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { view.current.hoverId = ''; view.current.highlight = null; setHover(null); }}
      />

      {/* Toolbar */}
      <div className="absolute left-3 top-3 right-3 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border bg-background/80 backdrop-blur px-2 h-8 w-56 max-w-full">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && view.current.match?.size) fit(view.current.match); }}
            placeholder={t('memory.brain.search')}
            aria-label={t('memory.brain.search')}
            className="flex-1 min-w-0 bg-transparent text-xs outline-none"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('memory.brain.clear')}><X className="h-3 w-3 text-muted-foreground" /></button>}
        </div>
        {rootId && (
          <div className="pointer-events-auto flex rounded-md border bg-background/80 backdrop-blur p-0.5 text-[11px]">
            <button type="button" onClick={() => setAll(false)} className={cn('px-2 h-6 rounded', !all && 'bg-accent font-medium')}>{rootLabel ?? t('memory.brain.thisMemory')}</button>
            <button type="button" onClick={() => setAll(true)} className={cn('px-2 h-6 rounded', all && 'bg-accent font-medium')}>{t('memory.brain.allMemories')}</button>
          </div>
        )}
        <div className="ml-auto pointer-events-auto flex items-center gap-1">
          <IconBtn label={paused ? t('memory.brain.play') : t('memory.brain.pause')} onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </IconBtn>
          <IconBtn label={t('memory.brain.fit')} onClick={() => fit()}><Maximize2 className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label={t('memory.brain.reload')} onClick={() => void load()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </IconBtn>
        </div>
      </div>

      {/* Projects + link types */}
      {model && (
        <div className="absolute left-3 bottom-3 max-w-[70%] flex flex-col gap-1.5 pointer-events-none">
          {model.projects.length > 0 && (
            <div className="pointer-events-auto flex flex-wrap gap-1">
              {model.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setHiddenProjects((s) => toggle(s, p.id))}
                  onDoubleClick={() => fit(new Set(model.nodes.filter((n) => n.hub === p.id).map((n) => n.id)))}
                  title={t('memory.brain.projectHint')}
                  className={cn('flex items-center gap-1.5 rounded-full border bg-background/80 backdrop-blur px-2 h-6 text-[11px]', hiddenProjects.has(p.id) && 'opacity-40 line-through')}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
                  {p.title}
                </button>
              ))}
            </div>
          )}
          <div className="pointer-events-auto flex flex-wrap gap-1">
            {ALL_TYPES.filter((ty) => model.links.some((l) => l.type === ty)).map((ty) => (
              <button
                key={ty}
                type="button"
                onClick={() => setHiddenTypes((s) => toggle(s, ty))}
                className={cn('flex items-center gap-1 rounded-full border bg-background/80 backdrop-blur px-2 h-5 text-[10px]', hiddenTypes.has(ty) && 'opacity-40 line-through')}
              >
                <span className="h-0.5 w-3 rounded" style={{ background: LINK_COLORS[ty] }} />
                {t(`memory.links.types.${ty}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {stats && (
        <div className="absolute right-3 bottom-3 rounded-md border bg-background/80 backdrop-blur px-2 py-1 text-[10px] text-muted-foreground tabular-nums pointer-events-none">
          {t('memory.brain.stats', { cards: stats.cards, projects: stats.projects, links: stats.links, crossing: stats.crossing })}
          {graph?.truncated && <span className="ml-1 text-amber-600 dark:text-amber-400">· {t('memory.brain.truncated')}</span>}
        </div>
      )}

      {/* Hover card */}
      {hv && !dragging.current && (
        <div
          className="absolute z-10 max-w-xs rounded-lg border bg-popover/95 backdrop-blur shadow-xl px-3 py-2 text-xs pointer-events-none"
          style={{ left: Math.min(hover!.x + 14, (wrapRef.current?.clientWidth ?? 0) - 300), top: hover!.y + 14 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: hv.color }} />
            <span className="font-medium text-sm leading-tight">{hv.title}</span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(`memory.brain.kind.${hv.kind}`)}
            {hv.hub && model?.byId.get(hv.hub) && hv.kind !== 'project' ? ` · ${model.byId.get(hv.hub)!.title}` : ''}
            {hv.stale ? ` · ${t('memory.stale')}` : ''}
          </div>
          {hv.summary && <p className="mt-1 text-muted-foreground line-clamp-4">{hv.summary}</p>}
          {(hv.agent || hv.updatedAt) && hv.kind === 'card' && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {hv.agent || t('memory.source.human')}{hv.updatedAt ? ` · ${formatWhen(hv.updatedAt, i18n.language)}` : ''}
            </p>
          )}
          {model && (model.neighbors.get(hv.id)?.size ?? 0) > 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground">{t('memory.brain.linksN', { count: model.neighbors.get(hv.id)!.size })}</p>
          )}
        </div>
      )}

      {!graph && !error && (
        <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <p>{t('memory.brain.loadFailed')}</p>
          <button type="button" className="underline" onClick={() => void load()}>{t('memory.brain.reload')}</button>
        </div>
      )}
      {graph && graph.nodes.filter((n) => n.kind === 'card').length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="max-w-sm text-center text-sm text-muted-foreground">{t('memory.brain.empty')}</p>
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-8 w-8 flex items-center justify-center rounded-md border bg-background/80 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {children}
    </button>
  );
}

/** What hovering a node lights up: a card's links and project; a project's
 *  cards; the memory's projects. */
function litAround(model: BrainModel, n: BrainNode): Set<string> {
  const lit = new Set([n.id, ...(model.neighbors.get(n.id) ?? [])]);
  if (n.hub) lit.add(n.hub);
  if (n.kind === 'project') for (const m of model.nodes) if (m.hub === n.id) lit.add(m.id);
  if (n.kind === 'folder') for (const m of model.nodes) if (m.parentId === n.id) lit.add(m.id);
  if (n.kind === 'memory') for (const m of model.nodes) if (m.memory === n.id && (m.kind === 'project' || !m.hub)) lit.add(m.id);
  return lit;
}

// ── geometry + colour helpers ─────────────────────────────────────────────

/** The control point of a gently bent edge (bend: fraction of its length). */
function bend(e: BrainEdge, k: number): [number, number] {
  const sx = e.source.x!, sy = e.source.y!, tx = e.target.x!, ty = e.target.y!;
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  return [mx - (ty - sy) * k, my + (tx - sx) * k];
}

function quad(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A soft round glow in one colour, drawn once and stamped for every signal. */
function glowSprite(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, hexA(color, 0.95));
  grad.addColorStop(0.35, hexA(color, 0.5));
  grad.addColorStop(1, hexA(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  sprites.set(color, c);
  return c;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** hsl(h s% l%) → hsl(h s% l% / a). */
function withAlpha(hsl: string, a: number): string {
  return hsl.startsWith('hsl(') ? hsl.replace(')', ` / ${a})`) : hsl;
}
