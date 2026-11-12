import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { BarChartBig, LineChart as LineIcon, PieChart as PieIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DBResultChartProps {
  columns: { name: string; type?: string }[];
  rows: Record<string, unknown>[];
}

type ChartKind = 'bar' | 'line' | 'pie';

const PIE_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb7185', '#c084fc'];

// DBResultChart renders the in-memory result as a chart. It only
// shows columns that look numeric and uses the first non-numeric
// column as the category axis by default.
export function DBResultChart({ columns, rows }: DBResultChartProps) {
  const { t } = useTranslation('dbquery');
  const numericCols = useMemo(() => columns.filter((c) => isNumericCol(c, rows)).map((c) => c.name), [columns, rows]);
  const otherCols = useMemo(() => columns.filter((c) => !numericCols.includes(c.name)).map((c) => c.name), [columns, numericCols]);

  const [kind, setKind] = useState<ChartKind>('bar');
  const [xCol, setXCol] = useState<string>(otherCols[0] ?? columns[0]?.name ?? '');
  const [yCol, setYCol] = useState<string>(numericCols[0] ?? '');

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        {t('chart.noData')}
      </div>
    );
  }

  if (!yCol) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
        {t('chart.noNumeric')}
      </div>
    );
  }

  const data = useMemo(() => {
    return rows.map((r, i) => ({
      _x: r[xCol] != null ? String(r[xCol]) : t('chart.rowLabel', { n: i + 1 }),
      [yCol]: typeof r[yCol] === 'number' ? r[yCol] : Number(r[yCol]),
    }));
  }, [rows, xCol, yCol, t]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b text-xs shrink-0">
        <span className="text-muted-foreground">{t('chart.label')}</span>
        <div className="flex border rounded">
          <ChartKindBtn active={kind === 'bar'} onClick={() => setKind('bar')} icon={<BarChartBig className="h-3 w-3" />} label={t('chart.bar')} />
          <ChartKindBtn active={kind === 'line'} onClick={() => setKind('line')} icon={<LineIcon className="h-3 w-3" />} label={t('chart.line')} />
          <ChartKindBtn active={kind === 'pie'} onClick={() => setKind('pie')} icon={<PieIcon className="h-3 w-3" />} label={t('chart.pie')} />
        </div>
        <span className="text-[11px] text-muted-foreground ml-2">X</span>
        <Select value={xCol} onValueChange={setXCol}>
          <SelectTrigger className="h-6 text-[11px] w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {columns.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground ml-1">Y</span>
        <Select value={yCol} onValueChange={setYCol}>
          <SelectTrigger className="h-6 text-[11px] w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {numericCols.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 min-h-0 p-3">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar' ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="_x" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip wrapperClassName="!text-xs" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey={yCol} fill="#22d3ee" />
            </BarChart>
          ) : kind === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="_x" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip wrapperClassName="!text-xs" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey={yCol} stroke="#a78bfa" strokeWidth={2} dot={false} />
            </LineChart>
          ) : (
            <PieChart>
              <Tooltip wrapperClassName="!text-xs" />
              <Pie data={data} dataKey={yCol} nameKey="_x" outerRadius="75%" label>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartKindBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn('h-6 px-2 text-[11px] rounded-none gap-1', active && 'bg-accent')}
    >
      {icon}
      {label}
    </Button>
  );
}

function isNumericCol(c: { name: string; type?: string }, rows: Record<string, unknown>[]): boolean {
  if (c.type) {
    const t = c.type.toLowerCase();
    if (/(int|numeric|decimal|float|double|real|bigint|smallint|number|long|short)/.test(t)) return true;
  }
  let count = 0;
  let numeric = 0;
  for (const r of rows) {
    if (r[c.name] == null) continue;
    count += 1;
    const v = r[c.name];
    if (typeof v === 'number' && Number.isFinite(v)) numeric += 1;
    if (count >= 25) break;
  }
  return count > 0 && numeric / count > 0.7;
}
