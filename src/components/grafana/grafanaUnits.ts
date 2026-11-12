// Grafana unit formatting — the subset of Grafana's value formats that covers
// typical infrastructure dashboards. Unknown units fall back to the number
// plus the unit id as a suffix (Grafana's "custom unit" behaviour), and the
// explicit `suffix:` / `prefix:` custom units are honoured.

const SI = ['', 'K', 'M', 'B', 'T', 'Q'];

function fixed(v: number, decimals?: number | null): string {
  if (!Number.isFinite(v)) return String(v);
  if (decimals != null && decimals >= 0) return v.toFixed(Math.min(decimals, 20));
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
  // Small numbers: keep 2 significant digits.
  return Number(v.toPrecision(2)).toString();
}

function scaled(v: number, base: number, units: string[], decimals?: number | null, offset = 0): string {
  let i = offset;
  let x = v;
  while (Math.abs(x) >= base && i < units.length - 1) {
    x /= base;
    i++;
  }
  return `${fixed(x, decimals)} ${units[i]}`.trim();
}

function short(v: number, decimals?: number | null): string {
  let i = 0;
  let x = v;
  while (Math.abs(x) >= 1000 && i < SI.length - 1) {
    x /= 1000;
    i++;
  }
  return `${fixed(x, decimals)}${SI[i] ? ' ' + SI[i] : ''}`;
}

const IEC_BYTES = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
const SI_BYTES = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB'];
const IEC_BITS = ['b', 'Kib', 'Mib', 'Gib', 'Tib', 'Pib'];
const SI_BITS = ['b', 'kb', 'Mb', 'Gb', 'Tb', 'Pb'];

/** Duration from a value in `unitMs` milliseconds → "1.5 s", "2.3 h". */
function duration(v: number, unitMs: number, decimals?: number | null): string {
  const ms = v * unitMs;
  const a = Math.abs(ms);
  if (a === 0) return '0 s';
  if (a < 1e-3) return `${fixed(ms * 1e6, decimals)} ns`;
  if (a < 1) return `${fixed(ms * 1e3, decimals)} µs`;
  if (a < 1000) return `${fixed(ms, decimals)} ms`;
  if (a < 60_000) return `${fixed(ms / 1000, decimals)} s`;
  if (a < 3_600_000) return `${fixed(ms / 60_000, decimals)} min`;
  if (a < 86_400_000) return `${fixed(ms / 3_600_000, decimals)} hour`;
  if (a < 604_800_000) return `${fixed(ms / 86_400_000, decimals)} day`;
  return `${fixed(ms / 604_800_000, decimals)} week`;
}

/** "1h 20m" style (dtdurations). */
function humanDuration(seconds: number): string {
  let s = Math.abs(Math.round(seconds));
  const parts: string[] = [];
  const units: Array<[string, number]> = [['y', 31536000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  for (const [u, n] of units) {
    if (s >= n) {
      parts.push(`${Math.floor(s / n)}${u}`);
      s %= n;
    }
    if (parts.length === 2) break;
  }
  return (seconds < 0 ? '-' : '') + (parts.join(' ') || '0s');
}

const RATE: Record<string, string> = {
  reqps: 'req/s', rps: 'reads/s', wps: 'writes/s', iops: 'io/s', ops: 'ops/s', opm: 'ops/min',
  rpm: 'req/min', reqpm: 'req/min', cps: 'c/s', mps: 'msg/s', eps: 'events/s',
};

const CURRENCY: Record<string, string> = {
  currencyUSD: '$', currencyEUR: '€', currencyGBP: '£', currencyTRY: '₺', currencyJPY: '¥', currencyRUB: '₽',
};

export function formatValue(value: unknown, unit?: string, decimals?: number | null): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'string' && !Number.isFinite(Number(value))) return value;
  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v)) return String(value);
  const u = (unit ?? '').trim();
  if (u.startsWith('suffix:')) return `${fixed(v, decimals)}${u.slice(7)}`;
  if (u.startsWith('prefix:')) return `${u.slice(7)}${fixed(v, decimals)}`;
  if (u.startsWith('si:')) return `${short(v, decimals)}${u.slice(3)}`;
  if (CURRENCY[u]) return `${CURRENCY[u]}${short(v, decimals ?? 2)}`;
  if (RATE[u]) return `${short(v, decimals)} ${RATE[u]}`;
  switch (u) {
    case '':
    case 'short':
      return short(v, decimals);
    case 'none':
    case 'string':
      return fixed(v, decimals);
    case 'locale':
      return v.toLocaleString(undefined, decimals != null ? { maximumFractionDigits: decimals } : undefined);
    case 'percent':
      return `${fixed(v, decimals)}%`;
    case 'percentunit':
      return `${fixed(v * 100, decimals)}%`;
    case 'bool':
      return v ? 'true' : 'false';
    case 'bool_on_off':
      return v ? 'On' : 'Off';
    case 'bool_yes_no':
      return v ? 'Yes' : 'No';
    case 'bytes':
      return scaled(v, 1024, IEC_BYTES, decimals);
    case 'decbytes':
      return scaled(v, 1000, SI_BYTES, decimals);
    case 'bits':
      return scaled(v, 1024, IEC_BITS, decimals);
    case 'decbits':
      return scaled(v, 1000, SI_BITS, decimals);
    case 'kbytes':
      return scaled(v, 1024, IEC_BYTES, decimals, 1);
    case 'deckbytes':
      return scaled(v, 1000, SI_BYTES, decimals, 1);
    case 'mbytes':
      return scaled(v, 1024, IEC_BYTES, decimals, 2);
    case 'decmbytes':
      return scaled(v, 1000, SI_BYTES, decimals, 2);
    case 'gbytes':
      return scaled(v, 1024, IEC_BYTES, decimals, 3);
    case 'decgbytes':
      return scaled(v, 1000, SI_BYTES, decimals, 3);
    case 'Bps':
    case 'binBps':
      return `${scaled(v, u === 'Bps' ? 1000 : 1024, u === 'Bps' ? SI_BYTES : IEC_BYTES, decimals)}/s`;
    case 'bps':
    case 'binbps':
      return `${scaled(v, u === 'bps' ? 1000 : 1024, u === 'bps' ? SI_BITS : IEC_BITS, decimals)}/s`;
    case 'KBs':
      return `${scaled(v, 1000, SI_BYTES, decimals, 1)}/s`;
    case 'MBs':
      return `${scaled(v, 1000, SI_BYTES, decimals, 2)}/s`;
    case 'ns':
      return duration(v, 1e-6, decimals);
    case 'µs':
    case 'us':
      return duration(v, 1e-3, decimals);
    case 'ms':
      return duration(v, 1, decimals);
    case 's':
      return duration(v, 1000, decimals);
    case 'm':
      return duration(v, 60_000, decimals);
    case 'h':
      return duration(v, 3_600_000, decimals);
    case 'd':
      return duration(v, 86_400_000, decimals);
    case 'dtdurations':
    case 'dthms':
      return humanDuration(v);
    case 'dtdurationms':
      return humanDuration(v / 1000);
    case 'celsius':
      return `${fixed(v, decimals)}°C`;
    case 'fahrenheit':
      return `${fixed(v, decimals)}°F`;
    case 'hertz':
      return `${short(v, decimals)}Hz`;
    case 'watt':
      return `${short(v, decimals)}W`;
    case 'dateTimeAsIso':
    case 'dateTimeAsSystem':
      return new Date(v).toLocaleString();
    case 'dateTimeFromNow':
      return relativeFromNow(v);
  }
  return `${fixed(v, decimals)} ${u}`;
}

function relativeFromNow(ms: number): string {
  const diff = (Date.now() - ms) / 1000;
  return diff >= 0 ? `${humanDuration(diff)} ago` : `in ${humanDuration(-diff)}`;
}

/** Compact axis tick (no unit noise for huge counts). */
export function formatTick(value: number, unit?: string): string {
  return formatValue(value, unit, null);
}
