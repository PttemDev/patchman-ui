import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function StatTile({ label, value, sub, tone, title }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad' | 'good'; title?: string;
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2 min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold tabular-nums leading-tight truncate',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {value}
      </div>
      {sub != null && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

const TYPE_STYLE: Record<string, string> = {
  quorum: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  stream: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  classic: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  topic: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  fanout: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  direct: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  headers: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
};

export function TypeBadge({ type }: { type?: string }) {
  const k = type || 'classic';
  return (
    <span className={cn('rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide shrink-0', TYPE_STYLE[k] ?? 'bg-muted text-muted-foreground')}>
      {k.replace(/^x-/, '')}
    </span>
  );
}

export function Chip({ children, tone, title }: { children: ReactNode; tone?: 'warn' | 'bad' | 'info'; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'rounded border px-1.5 py-px text-[10px] font-mono shrink-0',
        tone === 'warn' ? 'border-amber-500/40 text-amber-700 dark:text-amber-300'
          : tone === 'bad' ? 'border-destructive/40 text-destructive'
            : tone === 'info' ? 'border-sky-500/40 text-sky-700 dark:text-sky-300'
              : 'border-border text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

export function RefreshControl({ value, onChange, onRefresh, loading }: {
  value: string; onChange: (v: string) => void; onRefresh: () => void; loading?: boolean;
}) {
  const { t } = useTranslation('rabbit');
  return (
    <div className="flex items-center">
      <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-r-none" onClick={onRefresh} title={t('common:refresh')}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </Button>
      <Select value={value || 'off'} onValueChange={(v) => onChange(v === 'off' ? '' : v)}>
        <SelectTrigger className="h-7 w-[68px] rounded-l-none border-l-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{t('refresh.off')}</SelectItem>
          {['5', '10', '30', '60'].map((s) => <SelectItem key={s} value={s}>{s}s</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation('rabbit');
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-1">
        <div className="break-words">{message}</div>
        {onRetry && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>{t('common:retry')}</Button>}
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="h-40 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}

export function SortTh({ label, field, sort, reverse, onSort, className }: {
  label: string; field: string; sort: string; reverse: boolean; onSort: (f: string) => void; className?: string;
}) {
  return (
    <th className={cn('font-medium px-2 py-1.5 select-none cursor-pointer hover:text-foreground whitespace-nowrap', className)} onClick={() => onSort(field)}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sort === field && (reverse ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </span>
    </th>
  );
}

export function Bar({ used, total, alarm }: { used: number; total: number; alarm?: boolean }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
      <div className={cn('h-full', alarm ? 'bg-destructive' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
    </div>
  );
}
