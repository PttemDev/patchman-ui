import { useRequestStore } from '@/stores/requestStore';
import type { RabbitMessage, RabbitMessageStats, RabbitQueue, RabbitRate, Tab } from '@/types';

// Shared helpers for the RabbitMQ views: number/byte/rate formatting,
// management-stats access, payload decoding and the tab openers.

export function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function fmtRate(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  if (n === 0) return '0';
  if (n < 0.1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return fmtNum(Math.round(n));
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function rateObj(stats: RabbitMessageStats | undefined, key: string): RabbitRate | undefined {
  const v = stats?.[key];
  return v && typeof v === 'object' ? (v as RabbitRate) : undefined;
}

/** message_stats.<key>.rate, or undefined when the broker keeps no stats. */
export function rateOf(stats: RabbitMessageStats | undefined, key: string): number | undefined {
  return rateObj(stats, key)?.rate;
}

/** Samples (newest first in the API) → chart points, oldest first. */
export function samplePoints(r: RabbitRate | undefined): Array<{ t: number; v: number | null }> {
  return [...(r?.samples ?? [])].reverse().map((s) => ({ t: s.timestamp, v: s.sample }));
}

/** Rate samples are cumulative counters: turn them into per-second rates. */
export function rateSeries(r: RabbitRate | undefined): Array<{ t: number; v: number | null }> {
  const pts = samplePoints(r);
  const out: Array<{ t: number; v: number | null }> = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    const dv = (pts[i].v ?? 0) - (pts[i - 1].v ?? 0);
    out.push({ t: pts[i].t, v: dt > 0 ? Math.max(0, dv / dt) : null });
  }
  return out;
}

export function statsOf(stats: RabbitMessageStats | undefined, key: string): RabbitRate | undefined {
  return rateObj(stats, key);
}

/** Effective queue settings from arguments + policy (policy keys lack the x- prefix). */
export function queueSetting(q: RabbitQueue, key: string): unknown {
  const arg = q.arguments?.[`x-${key}`];
  if (arg !== undefined) return arg;
  const pol = q.effective_policy_definition;
  if (pol && !Array.isArray(pol)) return (pol as Record<string, unknown>)[key];
  return undefined;
}

export function isDeadLetterQueue(q: RabbitQueue): boolean {
  return /(^|[._-])(dlq|dead|deadletter|dead-letter|error|parking)([._-]|$)/i.test(q.name);
}

export function vhostLabel(vhost: string): string {
  return vhost === '/' ? '/' : vhost;
}

// ── messages ────────────────────────────────────────────────────────

export type DecodeMode = 'auto' | 'text' | 'json' | 'hex' | 'base64';

export function messageProps(m: RabbitMessage): Record<string, unknown> {
  return Array.isArray(m.properties) ? {} : m.properties ?? {};
}

export function payloadBytes(m: RabbitMessage): Uint8Array {
  if (m.payload_encoding === 'base64') {
    try {
      const bin = atob(m.payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return new TextEncoder().encode(m.payload);
    }
  }
  return new TextEncoder().encode(m.payload);
}

function toHex(b: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < b.length && i < 4096; i += 16) {
    const chunk = Array.from(b.slice(i, i + 16));
    rows.push(`${i.toString(16).padStart(6, '0')}  ${chunk.map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${chunk.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')}`);
  }
  return rows.join('\n');
}

export function decodePayload(m: RabbitMessage, mode: DecodeMode): { text: string; kind: 'json' | 'text' | 'binary' } {
  if (mode === 'hex') return { text: toHex(payloadBytes(m)), kind: 'binary' };
  if (mode === 'base64') {
    return { text: m.payload_encoding === 'base64' ? m.payload : btoa(String.fromCharCode(...payloadBytes(m).slice(0, 65536))), kind: 'text' };
  }
  let text = m.payload;
  if (m.payload_encoding === 'base64') {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes(m));
    } catch {
      return mode === 'auto' ? { text: toHex(payloadBytes(m)), kind: 'binary' } : { text: new TextDecoder().decode(payloadBytes(m)), kind: 'text' };
    }
  }
  if (mode === 'text') return { text, kind: 'text' };
  const trimmed = text.trim();
  if ((mode === 'json' || mode === 'auto') && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), kind: 'json' };
    } catch { /* not JSON */ }
  }
  return { text, kind: 'text' };
}

export function previewPayload(m: RabbitMessage): string {
  const d = decodePayload(m, 'auto');
  if (d.kind === 'binary') return `‹${m.payload_bytes} bytes binary›`;
  return d.text.replace(/\s+/g, ' ').slice(0, 200);
}

// ── tab openers ─────────────────────────────────────────────────────

function open(match: (t: Tab) => boolean, tab: Partial<Tab>, update?: Partial<Tab>) {
  const rs = useRequestStore.getState();
  const existing = rs.tabs.find(match);
  if (existing) {
    if (update) rs.updateTab(existing.id, update);
    rs.setActiveTab(existing.id);
    return;
  }
  rs.addTab({ type: 'rabbit', method: 'GET', url: '', ...tab } as Tab, true);
}

/** Cluster tab of a connection (one per connection). */
export function openRabbitCluster(connId: string, name: string, section?: Tab['rabbitSection'], vhost?: string) {
  open(
    (t) => t.type === 'rabbit' && t.rabbitConnectionId === connId && (t.rabbitView ?? 'cluster') === 'cluster',
    { name, rabbitConnectionId: connId, rabbitView: 'cluster', rabbitSection: section ?? 'overview', rabbitVhost: vhost ?? '' },
    section || vhost !== undefined ? { ...(section ? { rabbitSection: section } : {}), ...(vhost !== undefined ? { rabbitVhost: vhost } : {}) } : undefined,
  );
}

export function openRabbitQueue(connId: string, vhost: string, queue: string, pane?: string) {
  open(
    (t) => t.type === 'rabbit' && t.rabbitConnectionId === connId && t.rabbitView === 'queue' && t.rabbitVhost === vhost && t.rabbitQueue === queue,
    { name: queue, rabbitConnectionId: connId, rabbitView: 'queue', rabbitVhost: vhost, rabbitQueue: queue, rabbitPane: pane ?? 'messages' },
    pane ? { rabbitPane: pane } : undefined,
  );
}

export function openRabbitExchange(connId: string, vhost: string, exchange: string, pane?: string) {
  open(
    (t) => t.type === 'rabbit' && t.rabbitConnectionId === connId && t.rabbitView === 'exchange' && t.rabbitVhost === vhost && t.rabbitExchange === exchange,
    { name: exchange || '(AMQP default)', rabbitConnectionId: connId, rabbitView: 'exchange', rabbitVhost: vhost, rabbitExchange: exchange, rabbitPane: pane ?? 'bindings' },
    pane ? { rabbitPane: pane } : undefined,
  );
}

/** The management UI's address for a queue / exchange (deep link). */
export function managementLink(baseUrl: string, kind: 'queues' | 'exchanges', vhost: string, name: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${base}/#/${kind}/${encodeURIComponent(vhost)}/${encodeURIComponent(name || 'amq.default')}`;
}
