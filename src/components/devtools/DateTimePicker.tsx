import { useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  setMinutes,
  setSeconds,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { enUS, tr, es, zhCN, type Locale } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: Date;
  onChange: (d: Date) => void;
}

// Monday-first weekday abbreviations (translation keys, resolved at render).
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

// Map the active UI language to a date-fns locale so the month header
// (MMMM yyyy) renders localized month names.
const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, tr, es, zh: zhCN };

// DateTimePicker is a themed, app-styled replacement for the native
// <input type="datetime-local"> — a calendar popover + H/M/S inputs, all
// operating in local time. Fully controlled via value/onChange.
export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const { t, i18n } = useTranslation('devtools');
  const dateLocale = DATE_FNS_LOCALES[i18n.language] ?? enUS;
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(value);

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const pickDay = (day: Date) => {
    // Keep the current time-of-day; only move the date.
    const next = setSeconds(setMinutes(setHours(day, value.getHours()), value.getMinutes()), value.getSeconds());
    onChange(next);
  };

  const setTimePart = (part: 'h' | 'm' | 's', raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    const max = part === 'h' ? 23 : 59;
    const clamped = Math.max(0, Math.min(max, n));
    if (part === 'h') onChange(setHours(value, clamped));
    else if (part === 'm') onChange(setMinutes(value, clamped));
    else onChange(setSeconds(value, clamped));
  };

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setViewMonth(value); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start gap-2 font-mono text-xs max-w-xs w-full">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {format(value, 'yyyy-MM-dd HH:mm:ss')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-3">
        {/* Month header */}
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-medium">{format(viewMonth, 'MMMM yyyy', { locale: dateLocale })}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Weekday row */}
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WEEKDAY_KEYS.map((w) => (
            <div key={w} className="text-[10px] text-muted-foreground text-center py-0.5">{t(`datetime.weekday.${w}`)}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((day) => {
            const selected = isSameDay(day, value);
            const outside = !isSameMonth(day, viewMonth);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => pickDay(day)}
                className={cn(
                  'h-7 rounded text-xs tabular-nums transition-colors',
                  selected
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'hover:bg-accent',
                  !selected && outside && 'text-muted-foreground/40',
                  !selected && isToday(day) && 'ring-1 ring-primary/50',
                )}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        {/* Time inputs */}
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">{t('datetime.time')}</span>
          <Input value={pad(value.getHours())} onChange={(e) => setTimePart('h', e.target.value)} className="h-7 w-11 text-xs font-mono text-center px-1" inputMode="numeric" />
          <span className="text-muted-foreground">:</span>
          <Input value={pad(value.getMinutes())} onChange={(e) => setTimePart('m', e.target.value)} className="h-7 w-11 text-xs font-mono text-center px-1" inputMode="numeric" />
          <span className="text-muted-foreground">:</span>
          <Input value={pad(value.getSeconds())} onChange={(e) => setTimePart('s', e.target.value)} className="h-7 w-11 text-xs font-mono text-center px-1" inputMode="numeric" />
          <Button variant="ghost" size="sm" className="h-7 text-[11px] ml-auto" onClick={() => onChange(new Date())}>
            {t('actions.now')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
