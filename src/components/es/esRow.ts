// Shared row helpers for the Elasticsearch index/alias listings. Both the
// console's ESIndexBrowser panel and the ESSidebar tree render the same rows,
// so the health-dot colours, humanized counts/sizes, and the alias badge rules
// live here once to keep the two surfaces from drifting apart.
import type { AliasRow } from '@/types';

export function healthDot(health: string): string {
  if (health === 'green') return 'bg-emerald-500';
  if (health === 'yellow') return 'bg-amber-500';
  if (health === 'red') return 'bg-destructive';
  return 'bg-muted-foreground/40';
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

// store/pri store sizes come back as a raw byte count (the _cat query uses
// bytes=b so they sort numerically) — render them human-readable here.
export function formatBytes(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return s || '0b';
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + units[i];
}

// _cat/aliases returns one row per (alias, index) pair. In a listing we want one
// row per alias, so collapse the pairs: collect the target indices and OR the
// write / filtered / routing facts across the group.
export interface AliasGroup {
  alias: string;
  indices: string[];
  write: boolean;
  filtered: boolean;
  routing: boolean;
}

export function aliasRowFiltered(a: AliasRow): boolean {
  return !!a.filter && a.filter !== '-';
}

export function aliasRowRouted(a: AliasRow): boolean {
  return (!!a.routingIndex && a.routingIndex !== '-') || (!!a.routingSearch && a.routingSearch !== '-');
}

export function groupAliases(rows: AliasRow[]): AliasGroup[] {
  const map = new Map<string, AliasGroup>();
  for (const a of rows) {
    let g = map.get(a.alias);
    if (!g) {
      g = { alias: a.alias, indices: [], write: false, filtered: false, routing: false };
      map.set(a.alias, g);
    }
    if (a.index && !g.indices.includes(a.index)) g.indices.push(a.index);
    if (a.isWriteIndex === 'true') g.write = true;
    if (aliasRowFiltered(a)) g.filtered = true;
    if (aliasRowRouted(a)) g.routing = true;
  }
  return Array.from(map.values()).sort((x, y) => x.alias.localeCompare(y.alias));
}
