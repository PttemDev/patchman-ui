import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  classifyValue,
  formatCellPreview,
  isLikelyBytes,
  isLikelyMs,
  isLikelyTimestamp,
  formatBytes,
  formatDurationMs,
  formatDate,
} from './formatters';

interface CellRendererProps {
  value: unknown;
  colName: string;
  colType?: string;
}

// CellRenderer is the visual element rendered in each grid cell.
// It applies a colour + an optional badge (e.g. bytes, relative time)
// and falls back to a clean preview string. The full value is reachable
// via the cell inspector drawer.
//
// Memoized: cell values are stable across grid re-renders (sort / filter /
// resize / column-pref changes), so we skip re-running classifyValue +
// per-cell formatting for every visible cell on each of those interactions.
export const CellRenderer = memo(function CellRenderer({ value, colName, colType }: CellRendererProps) {
  const { t } = useTranslation('dbquery');
  if (value === null) {
    return <span className="italic text-muted-foreground/60 select-none">NULL</span>;
  }
  if (value === undefined) {
    return <span className="italic text-muted-foreground/40 select-none">∅</span>;
  }
  const cls = classifyValue(value, colType);

  if (cls === 'boolean') {
    const b = Boolean(value);
    return (
      <span className={cn('font-semibold tabular-nums', b ? 'text-green-500' : 'text-rose-500')}>
        {b ? 'true' : 'false'}
      </span>
    );
  }

  if (cls === 'number' || cls === 'bigint') {
    const n = typeof value === 'bigint' ? Number(value) : (value as number);
    if (isLikelyBytes(colName, colType)) {
      return (
        <span className="font-mono tabular-nums" title={String(n) + ' bytes'}>
          {formatBytes(n)}
        </span>
      );
    }
    if (isLikelyMs(colName)) {
      return (
        <span className="font-mono tabular-nums" title={String(n) + ' ms'}>
          {formatDurationMs(n)}
        </span>
      );
    }
    return (
      <span className="font-mono tabular-nums text-purple-500 dark:text-purple-300">
        {n.toLocaleString()}
      </span>
    );
  }

  if (cls === 'date' || isLikelyTimestamp(colType)) {
    const { short, full, relative } = formatDate(value);
    return (
      <span
        className="font-mono text-emerald-600 dark:text-emerald-300"
        title={`${full}\n${relative}`}
      >
        {short}
      </span>
    );
  }

  if (cls === 'json' || cls === 'jsonb') {
    let s: string;
    if (typeof value === 'string') s = value;
    else {
      try { s = JSON.stringify(value); } catch { s = String(value); }
    }
    return (
      <span className="font-mono text-blue-500 dark:text-blue-300" title={s}>
        {s.length > 80 ? s.slice(0, 77) + '…' : s}
      </span>
    );
  }

  if (cls === 'uuid') {
    return (
      <span className="font-mono text-amber-600 dark:text-amber-400" title={String(value)}>
        {String(value)}
      </span>
    );
  }

  if (cls === 'url') {
    const s = String(value);
    return (
      <a
        href={s}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-sky-500 hover:underline truncate"
      >
        {s.length > 60 ? s.slice(0, 57) + '…' : s}
      </a>
    );
  }

  if (cls === 'email') {
    const s = String(value);
    return (
      <a
        href={`mailto:${s}`}
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-sky-500 hover:underline"
      >
        {s}
      </a>
    );
  }

  if (cls === 'binary') {
    return <span className="font-mono text-muted-foreground italic">{t('cellRender.binary')}</span>;
  }

  // Default string
  const s = String(value);
  if (s.length > 120) {
    return (
      <span className="font-mono" title={s}>
        {s.slice(0, 117)}…
      </span>
    );
  }
  return <span className="font-mono">{s}</span>;
});

// Re-export the preview formatter so callers (export, summary)
// have one canonical string form.
export { formatCellPreview };
