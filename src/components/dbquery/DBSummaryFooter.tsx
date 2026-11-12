import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sigma, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DBSummaryFooterProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

// Sticky footer with optional aggregates for a chosen numeric column.
// Defaults to "off" so it doesn't crowd the result for casual users.
export function DBSummaryFooter({ columns, rows }: DBSummaryFooterProps) {
  const { t } = useTranslation('dbquery');
  const [pickedCol, setPickedCol] = useState<string>('');
  const numericCols = useMemo(() => {
    const out: string[] = [];
    for (const c of columns) {
      let count = 0;
      let numeric = 0;
      for (const r of rows) {
        if (r[c] == null) continue;
        count += 1;
        if (typeof r[c] === 'number' && Number.isFinite(r[c] as number)) numeric += 1;
        if (count >= 25) break;
      }
      if (count > 0 && numeric / count > 0.6) out.push(c);
    }
    return out;
  }, [columns, rows]);

  const agg = useMemo(() => {
    if (!pickedCol) return null;
    return aggregate(rows.map((r) => r[pickedCol]));
  }, [pickedCol, rows]);

  return (
    <div className="flex items-center gap-3 px-3 py-1 border-t bg-muted/20 text-[11px] shrink-0">
      <Sigma className="h-3 w-3 text-muted-foreground" />
      <Select value={pickedCol} onValueChange={setPickedCol}>
        <SelectTrigger className="h-6 text-[11px] w-[200px]">
          <SelectValue placeholder={t('summary.aggregatePlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {columns.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">{t('summary.noColumns')}</div>
          ) : (
            <>
              {numericCols.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">{t('summary.numeric')}</div>
                  {numericCols.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <div className="border-t my-1" />
                </>
              )}
              <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">{t('summary.all')}</div>
              {columns.filter((c) => !numericCols.includes(c)).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </>
          )}
        </SelectContent>
      </Select>
      {agg && (
        <>
          <Stat k={t('summary.count')} v={agg.count.toLocaleString()} />
          <Stat k={t('summary.nonNull')} v={agg.nonNull.toLocaleString()} />
          {agg.numericCount > 0 && (
            <>
              <Stat k={t('summary.sum')} v={fmt(agg.sum)} />
              <Stat k={t('summary.avg')} v={fmt(agg.avg)} />
              <Stat k={t('summary.min')} v={fmt(agg.min)} />
              <Stat k={t('summary.max')} v={fmt(agg.max)} />
            </>
          )}
          <Stat k={t('summary.distinct')} v={agg.distinct.toLocaleString()} />
          <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => setPickedCol('')}>
            <X className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span className="font-mono tabular-nums">
      <span className="text-muted-foreground uppercase text-[10px] mr-1">{k}</span>
      {v}
    </span>
  );
}

function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function aggregate(values: unknown[]) {
  let count = 0;
  let nonNull = 0;
  let numericCount = 0;
  let sum = 0;
  let min: number | undefined;
  let max: number | undefined;
  const seen = new Set<string>();
  for (const v of values) {
    count += 1;
    if (v == null) continue;
    nonNull += 1;
    if (typeof v === 'number' && Number.isFinite(v)) {
      numericCount += 1;
      sum += v;
      if (min === undefined || v < min) min = v;
      if (max === undefined || v > max) max = v;
    }
    const key = typeof v === 'object' ? JSON.stringify(v) : String(v);
    seen.add(key);
  }
  return {
    count, nonNull, numericCount, sum, min, max,
    avg: numericCount ? sum / numericCount : undefined,
    distinct: seen.size,
  };
}
