import { arcTable, edgeBezier, protoClass, tAt, CLASS_VAR, type ProtoClass } from './serviceMapUtil';

// The "requests in flight" layer: a canvas above the map where every edge
// with observed traffic emits glowing particles from caller to callee —
// as many as its requests/s (log-scaled), red in proportion to its error
// rate, slower when its p95 latency is high. Consumers' particles flow from
// the broker to them. A pulse ring marks each arrival. The engine draws in
// flow coordinates and applies the React Flow viewport itself, so it stays
// glued to the edges while panning and zooming.

export interface FlowEdgeSpec {
  id: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  rps: number;
  errorRate: number;
  p95Ms: number;
  rateOnly: boolean;
  conns: number;
  protocol?: string;
  reverse: boolean;
  lane: number;
}

export type MotionMode = 'full' | 'calm' | 'off';

interface EdgeState {
  spec: FlowEdgeSpec;
  table: ReturnType<typeof arcTable>;
  bez: ReturnType<typeof edgeBezier>;
  rate: number; // particles / s (smoothed)
  targetRate: number;
  duration: number; // s per trip
  carry: number;
  cls: ProtoClass;
  dim: boolean;
  /** Bounding box of the curve, for viewport culling. */
  box: { x0: number; y0: number; x1: number; y1: number };
  visible: boolean;
}

interface Particle {
  e: EdgeState;
  born: number;
  err: boolean;
  jitter: number;
}

interface Pulse {
  x: number;
  y: number;
  born: number;
  err: boolean;
  cls: ProtoClass;
}

const MAX_PARTICLES = 2500;
/** Particles the whole map may keep in flight on average; dense maps share
 *  it, so every link still flows instead of the first ones starving the rest. */
const BUDGET = 1400;

export class ParticleEngine {
  private ctx: CanvasRenderingContext2D;
  private edges = new Map<string, EdgeState>();
  private particles: Particle[] = [];
  private pulses: Pulse[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private colors: Record<string, string> = {};
  private raf = 0;
  private last = 0;
  running = false;
  private density = 1;
  private frameAvg = 16;
  private viewport = { x: 0, y: 0, zoom: 1 };
  private dimSet: Set<string> | null = null;
  private dpr = 1;
  private w = 0;
  private h = 0;
  mode: MotionMode = 'full';
  /** Frames drawn (tests read this to prove the layer animates). */
  frames = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.readColors();
  }

  /** Re-reads the theme's colours (call after a theme change). */
  readColors() {
    const cs = getComputedStyle(this.canvas);
    for (const v of ['--sm-http', '--sm-data', '--sm-msg', '--sm-crit']) {
      this.colors[v] = cs.getPropertyValue(v).trim() || '#3987e5';
    }
    this.sprites.clear();
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setViewport(v: { x: number; y: number; zoom: number }) {
    this.viewport = v;
  }

  /** New edge set; rates of surviving edges ease to their new values and
   *  curves whose ends did not move keep their arc tables. */
  setEdges(specs: FlowEdgeSpec[]) {
    const next = new Map<string, EdgeState>();
    for (const spec of specs) {
      const prev = this.edges.get(spec.id);
      const same = prev && prev.spec.sx === spec.sx && prev.spec.sy === spec.sy && prev.spec.tx === spec.tx && prev.spec.ty === spec.ty && prev.spec.lane === spec.lane;
      const bez = same ? prev.bez : edgeBezier(spec.sx, spec.sy, spec.tx, spec.ty, spec.lane);
      const observed = spec.rps > 0 ? spec.rps : spec.conns > 0 ? 0.15 : 0;
      // log scale: 0.1 rps ≈ 0.4/s, 1 ≈ 1.2/s, 100 ≈ 5/s, 10k ≈ 9/s
      const targetRate = observed > 0 ? Math.min(10, 1.2 + 2 * Math.log10(1 + observed) - (observed < 1 ? 0.8 * (1 - observed) : 0)) : 0;
      const duration = Math.min(4.2, 1.5 * (1 + Math.log10(1 + (spec.p95Ms || 20) / 40)));
      const xs = [bez.p0.x, bez.p1.x, bez.p2.x, bez.p3.x];
      const ys = [bez.p0.y, bez.p1.y, bez.p2.y, bez.p3.y];
      const dim = !!this.dimSet && !this.dimSet.has(spec.id);
      next.set(spec.id, {
        spec,
        bez,
        table: same ? prev.table : arcTable(bez),
        rate: prev?.rate ?? 0,
        targetRate,
        duration,
        carry: prev?.carry ?? Math.random(),
        cls: protoClass(spec.protocol),
        dim,
        visible: true,
        box: { x0: Math.min(...xs) - 16, y0: Math.min(...ys) - 16, x1: Math.max(...xs) + 16, y1: Math.max(...ys) + 16 },
      });
    }
    // Particles on vanished edges finish quietly; the rest follow geometry.
    this.particles = this.particles.filter((p) => next.has(p.e.spec.id)).map((p) => ({ ...p, e: next.get(p.e.spec.id)! }));
    this.edges = next;
  }

  /** Dims every link outside `keep` (null = none dimmed). */
  setDim(keep: Set<string> | null) {
    this.dimSet = keep;
    for (const e of this.edges.values()) e.dim = !!keep && !keep.has(e.spec.id);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.tick(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    this.particles = [];
    this.edges.clear();
  }

  private sprite(color: string, err: boolean): HTMLCanvasElement {
    const key = `${color}|${err}`;
    let s = this.sprites.get(key);
    if (s) return s;
    const size = 32;
    s = document.createElement('canvas');
    s.width = s.height = size;
    const g = s.getContext('2d')!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, color);
    grad.addColorStop(0.45, hexA(color, 0.35));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    if (err) {
      // Secondary encoding: an error particle carries a ring, not just a hue.
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(size / 2, size / 2, 6, 0, Math.PI * 2);
      g.stroke();
    }
    this.sprites.set(key, s);
    return s;
  }

  private tick(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    // Adapt density to keep the frame budget.
    this.frameAvg = this.frameAvg * 0.95 + dt * 1000 * 0.05;
    if (this.frameAvg > 24 && this.density > 0.2) this.density *= 0.97;
    else if (this.frameAvg < 15 && this.density < 1) this.density = Math.min(1, this.density * 1.01);
    const { x: vx, y: vy, zoom } = this.viewport;
    // The visible part of the map, in flow coordinates.
    const view = { x0: -vx / zoom, y0: -vy / zoom, x1: (this.w - vx) / zoom, y1: (this.h - vy) / zoom };
    const visible = (b: EdgeState['box']) => b.x1 >= view.x0 && b.x0 <= view.x1 && b.y1 >= view.y0 && b.y0 <= view.y1;
    // On-screen links share the particle budget.
    let demand = 0;
    for (const e of this.edges.values()) {
      e.rate += ((e.dim ? e.targetRate * 0.25 : e.targetRate) - e.rate) * Math.min(1, dt * 1.5);
      e.visible = visible(e.box);
      if (e.visible) demand += e.rate * e.duration;
    }
    const share = demand > BUDGET ? BUDGET / demand : 1;
    const mult = (this.mode === 'calm' ? 0.35 : 1) * this.density * share;

    for (const e of this.edges.values()) {
      e.carry += e.rate * mult * dt;
      // Off-screen links keep their rhythm but spawn nothing.
      if (!e.visible) {
        if (e.carry > 1) e.carry = 1;
        continue;
      }
      while (e.carry >= 1 && this.particles.length < MAX_PARTICLES) {
        e.carry -= 1;
        const errP = e.spec.rateOnly ? 0 : e.spec.errorRate;
        this.particles.push({ e, born: now, err: Math.random() < errP, jitter: (Math.random() - 0.5) * 2.4 });
      }
      if (e.carry > 1) e.carry = 1;
    }

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr * zoom, 0, 0, this.dpr * zoom, this.dpr * vx, this.dpr * vy);
    ctx.globalCompositeOperation = 'lighter';
    const scale = Math.max(0.7, Math.min(1.6, 1 / Math.sqrt(zoom)));
    const alive: Particle[] = [];
    for (const p of this.particles) {
      const age = (now - p.born) / 1000;
      const frac = age / p.e.duration;
      if (frac >= 1) {
        if (this.mode === 'full' && this.pulses.length < 400) {
          const end = p.e.spec.reverse ? p.e.bez.p0 : p.e.bez.p3;
          this.pulses.push({ x: end.x, y: end.y, born: now, err: p.err, cls: p.e.cls });
        }
        continue;
      }
      alive.push(p);
      const f = p.e.spec.reverse ? 1 - frac : frac;
      const t = tAt(p.e.table, f);
      const b = p.e.bez;
      const u = 1 - t;
      const x = u * u * u * b.p0.x + 3 * u * u * t * b.p1.x + 3 * u * t * t * b.p2.x + t * t * t * b.p3.x;
      const y = u * u * u * b.p0.y + 3 * u * u * t * b.p1.y + 3 * u * t * t * b.p2.y + t * t * t * b.p3.y;
      if (x < view.x0 - 20 || x > view.x1 + 20 || y < view.y0 - 20 || y > view.y1 + 20) continue;
      const fade = Math.min(1, frac * 8, (1 - frac) * 10);
      const color = p.err ? this.colors['--sm-crit'] : this.colors[CLASS_VAR[p.e.cls]];
      const size = (p.err ? 15 : 11) * scale;
      ctx.globalAlpha = (p.e.dim ? 0.25 : 0.95) * fade;
      ctx.drawImage(this.sprite(color, p.err), x - size / 2 + p.jitter, y - size / 2, size, size);
    }
    this.particles = alive;

    if (this.mode === 'full') {
      const keep: Pulse[] = [];
      for (const pu of this.pulses) {
        const a = (now - pu.born) / 650;
        if (a >= 1) continue;
        keep.push(pu);
        if (pu.x < view.x0 - 30 || pu.x > view.x1 + 30 || pu.y < view.y0 - 30 || pu.y > view.y1 + 30) continue;
        ctx.globalAlpha = (1 - a) * 0.55;
        ctx.strokeStyle = pu.err ? this.colors['--sm-crit'] : this.colors[CLASS_VAR[pu.cls]];
        ctx.lineWidth = 1.4 / zoom;
        ctx.beginPath();
        ctx.ellipse(pu.x, pu.y, 4 + a * 18, 2 + a * 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.pulses = keep;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  get particleCount() {
    return this.particles.length;
  }

  get size() {
    return { w: this.w, h: this.h };
  }
}

/** #rrggbb + alpha → rgba(). */
function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(120,160,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
