import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { stringifyValue } from './formatters';

interface DBColumnStatsProps {
  colName: string;
  // Values are produced lazily — only pulled + scanned when the popover
  // opens (StatsBody mounts), so the grid header does zero per-render work.
  getValues: () => unknown[];
}

// DBColumnStats summarises a single column from the in-memory result.
// It runs on click (popover open) so it doesn't tax the first render.
export function DBColumnStats({ colName, getValues }: DBColumnStatsProps) {
  const { t } = useTranslation('dbquery');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-5 w-5 opacity-50 hover:opacity-100" title={t('stats.title')}>
          <BarChart3 className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <StatsBody colName={colName} getValues={getValues} />
      </PopoverContent>
    </Popover>
  );
}

function StatsBody({ colName, getValues }: DBColumnStatsProps) {
  const { t } = useTranslation('dbquery');
  // Compute exactly once, when the popover first mounts.
  const [stats] = useState(() => computeStats(getValues()));
  return (
    <div className="text-xs">
      <header className="px-3 py-2 border-b">
        <p className="font-mono text-xs truncate">{colName}</p>
        <p className="text-[10px] text-muted-foreground">
          {stats.count === 1
            ? t('units.rowsOne', { count: stats.count })
            : t('units.rowsOther', { count: stats.count })}
        </p>
      </header>
      <div className="px-3 py-2 grid grid-cols-2 gap-y-1 gap-x-3">
        <Stat k={t('stats.distinct')} v={stats.distinct.toLocaleString()} />
        <Stat k={t('stats.nulls')} v={`${stats.nulls} (${pct(stats.nulls, stats.count)})`} />
        {stats.numericCount > 0 && (
          <>
            <Stat k={t('stats.min')} v={fmt(stats.min)} />
            <Stat k={t('stats.max')} v={fmt(stats.max)} />
            <Stat k={t('stats.avg')} v={fmt(stats.avg)} />
            <Stat k={t('stats.sum')} v={fmt(stats.sum)} />
          </>
        )}
      </div>
      {stats.top.length > 0 && (
        <div className="border-t px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            {t('stats.topValues')}
          </p>
          <ul className="space-y-0.5">
            {stats.top.map((tv, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-mono truncate flex-1" title={tv.value}>{tv.value || <em className="text-muted-foreground">{t('stats.empty')}</em>}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {tv.count} · {pct(tv.count, stats.count)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono tabular-nums">{v}</span>
    </div>
  );
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return ((part / total) * 100).toFixed(1) + '%';
}

function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface ColumnStats {
  count: number;
  distinct: number;
  nulls: number;
  numericCount: number;
  min?: number;
  max?: number;
  sum: number;
  avg?: number;
  top: { value: string; count: number }[];
}

function computeStats(values: unknown[]): ColumnStats {
  let nulls = 0;
  let numericCount = 0;
  let sum = 0;
  let min: number | undefined;
  let max: number | undefined;
  const freq = new Map<string, number>();
  for (const v of values) {
    if (v == null) { nulls += 1; continue; }
    if (typeof v === 'number' && Number.isFinite(v)) {
      numericCount += 1;
      sum += v;
      if (min === undefined || v < min) min = v;
      if (max === undefined || v > max) max = v;
    }
    const key = stringifyValue(v);
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));
  return {
    count: values.length,
    distinct: freq.size,
    nulls,
    numericCount,
    sum,
    min,
    max,
    avg: numericCount ? sum / numericCount : undefined,
    top,
  };
}
