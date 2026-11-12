// Time-range helpers shared by the Grafana views (kept out of the component
// file so React fast refresh stays happy).

export const REFRESH_INTERVALS = ['', '5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'];

/** Milliseconds of a Grafana interval string ("30s", "5m"). */
export function intervalMs(s: unknown): number {
  if (typeof s !== 'string') return 0; // dashboards may say "refresh": false
  const m = /^(\d+)(s|m|h|d)$/.exec(s.trim());
  if (!m) return 0;
  return Number(m[1]) * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[m[2]];
}

export function isAbsolute(s: string) {
  return /^\d{10,}$/.test(s);
}

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Resolves "now-6h"-style expressions to epoch ms (client-side mirror of the BE parser, for zoom-out math). */
export function resolveTime(expr: string, roundUp = false): number {
  if (isAbsolute(expr)) return Number(expr);
  const m = /^now(?:([+-])(\d+)([smhdwMy]))?(?:\/([smhdwMy]))?$/.exec(expr.replace(/\s/g, ''));
  const d = new Date();
  if (!m) return d.getTime();
  if (m[2]) {
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    switch (m[3]) {
      case 's': d.setSeconds(d.getSeconds() + n); break;
      case 'm': d.setMinutes(d.getMinutes() + n); break;
      case 'h': d.setHours(d.getHours() + n); break;
      case 'd': d.setDate(d.getDate() + n); break;
      case 'w': d.setDate(d.getDate() + 7 * n); break;
      case 'M': d.setMonth(d.getMonth() + n); break;
      case 'y': d.setFullYear(d.getFullYear() + n); break;
    }
  }
  if (m[4]) {
    const u = m[4];
    if (u === 'd' || u === 'w' || u === 'M' || u === 'y') d.setHours(0, 0, 0, 0);
    if (u === 'w') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (u === 'M') d.setDate(1);
    if (u === 'y') d.setMonth(0, 1);
    if (u === 'h') d.setMinutes(0, 0, 0);
    if (roundUp) {
      if (u === 'd') d.setDate(d.getDate() + 1);
      else if (u === 'w') d.setDate(d.getDate() + 7);
      else if (u === 'M') d.setMonth(d.getMonth() + 1);
      else if (u === 'y') d.setFullYear(d.getFullYear() + 1);
      else if (u === 'h') d.setHours(d.getHours() + 1);
      return d.getTime() - 1;
    }
  }
  return d.getTime();
}
