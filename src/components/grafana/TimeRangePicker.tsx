import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, RefreshCw, ChevronDown, ZoomOut } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { REFRESH_INTERVALS, isAbsolute, resolveTime, toLocalInput } from './timeRange';

export interface TimeRange {
  from: string;
  to: string;
}

const QUICK: Array<{ from: string; to: string; key: string }> = [
  { from: 'now-5m', to: 'now', key: 'last5m' },
  { from: 'now-15m', to: 'now', key: 'last15m' },
  { from: 'now-30m', to: 'now', key: 'last30m' },
  { from: 'now-1h', to: 'now', key: 'last1h' },
  { from: 'now-3h', to: 'now', key: 'last3h' },
  { from: 'now-6h', to: 'now', key: 'last6h' },
  { from: 'now-12h', to: 'now', key: 'last12h' },
  { from: 'now-24h', to: 'now', key: 'last24h' },
  { from: 'now-2d', to: 'now', key: 'last2d' },
  { from: 'now-7d', to: 'now', key: 'last7d' },
  { from: 'now-30d', to: 'now', key: 'last30d' },
  { from: 'now-90d', to: 'now', key: 'last90d' },
  { from: 'now/d', to: 'now/d', key: 'today' },
  { from: 'now/d', to: 'now', key: 'todaySoFar' },
  { from: 'now-1d/d', to: 'now-1d/d', key: 'yesterday' },
  { from: 'now/w', to: 'now', key: 'weekSoFar' },
];

export function TimeRangePicker({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }) {
  const { t } = useTranslation('grafana');
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (!open) return;
    setFrom(isAbsolute(value.from) ? toLocalInput(Number(value.from)) : value.from);
    setTo(isAbsolute(value.to) ? toLocalInput(Number(value.to)) : value.to);
  }, [open, value]);

  const quick = QUICK.find((q) => q.from === value.from && q.to === value.to);
  const label = quick
    ? t(`time.${quick.key}`)
    : isAbsolute(value.from) || isAbsolute(value.to)
      ? `${new Date(resolveTime(value.from)).toLocaleString()} → ${new Date(resolveTime(value.to, true)).toLocaleString()}`
      : `${value.from} → ${value.to}`;

  const parseInput = (s: string): string => {
    if (/^now/.test(s.trim())) return s.trim();
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? s.trim() : String(ms);
  };

  const zoomOut = () => {
    const f = resolveTime(value.from);
    const tt = resolveTime(value.to, true);
    const span = tt - f;
    const nf = f - span / 2;
    const nt = Math.min(Date.now(), tt + span / 2);
    onChange({ from: String(Math.round(nf)), to: String(Math.round(nt)) });
  };

  return (
    <div className="flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 rounded-r-none max-w-[340px]">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[460px] p-0">
          <div className="grid grid-cols-[1fr_180px] divide-x">
            <div className="p-3 space-y-2">
              <div className="text-xs font-medium">{t('time.absolute')}</div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">{t('time.from')}</div>
                <Input value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 text-xs font-mono" placeholder="now-6h / 2026-10-19T10:00" />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">{t('time.to')}</div>
                <Input value={to} onChange={(e) => setTo(e.target.value)} className="h-7 text-xs font-mono" placeholder="now" />
              </div>
              <p className="text-[10px] text-muted-foreground">{t('time.hint')}</p>
              <Button size="sm" className="h-7 text-xs w-full" onClick={() => { onChange({ from: parseInput(from), to: parseInput(to) }); setOpen(false); }}>
                {t('time.apply')}
              </Button>
            </div>
            <div className="max-h-[300px] overflow-auto py-1">
              {QUICK.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => { onChange({ from: q.from, to: q.to }); setOpen(false); }}
                  className={cn('w-full text-left text-xs px-3 py-1 hover:bg-accent', quick?.key === q.key && 'bg-accent font-medium')}
                >
                  {t(`time.${q.key}`)}
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-l-none border-l-0" onClick={zoomOut} title={t('time.zoomOut')}>
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function RefreshPicker({ value, onChange, onRefresh, loading }: {
  value: string;
  onChange: (v: string) => void;
  onRefresh: () => void;
  loading?: boolean;
}) {
  const { t } = useTranslation('grafana');
  return (
    <div className="flex items-center">
      <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-r-none" onClick={onRefresh} title={t('time.refresh')}>
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs rounded-l-none border-l-0 px-2 gap-1">
            {value || t('time.off')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-28">
          {REFRESH_INTERVALS.map((iv) => (
            <DropdownMenuItem key={iv || 'off'} onClick={() => onChange(iv)} className={cn('text-xs', iv === value && 'font-medium')}>
              {iv || t('time.off')}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
