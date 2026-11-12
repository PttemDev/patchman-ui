import type { GrafanaFrame } from '@/types';
import { framesToSeries, isLogFrames, type TableData } from './grafanaFrames';

// Pure helpers for ResultView (kept out of the component file for React fast refresh).

export function defaultViewFor(frames: GrafanaFrame[]): 'graph' | 'table' | 'logs' | 'stats' {
  if (isLogFrames(frames)) return 'logs';
  return framesToSeries(frames).length > 0 ? 'graph' : 'table';
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCSV(t: TableData): string {
  const head = t.columns.map((c) => csvEscape(c.name)).join(',');
  const rows = t.rows.map((r) => r.map((v, i) => csvEscape(t.columns[i]?.type === 'time' && typeof v === 'number' ? new Date(v).toISOString() : v)).join(','));
  return [head, ...rows].join('\n');
}
