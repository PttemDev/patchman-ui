import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface PickerOption { value: string; label: string; sub?: string }

// A searchable picker over a remote list (git projects, Jira projects).
// Typing searches (debounced); a value not in the list can still be used
// as typed ("Use …"), e.g. a numeric project id.
export function SearchPicker({ value, onChange, load, placeholder, disabled, mono, deps = [], display, hint }: {
  value: string;
  onChange: (v: string) => void;
  load: (q: string) => Promise<PickerOption[]>;
  placeholder: string;
  disabled?: boolean;
  mono?: boolean;
  /** Reload when these change (e.g. the connection id). */
  deps?: unknown[];
  /** Text shown for the current value (default: the value / its option). */
  display?: string;
  /** A note under the list, e.g. "showing the first 50 — type to search". */
  hint?: (opts: PickerOption[], q: string) => string | undefined;
}) {
  const { t } = useTranslation('qa');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!open || disabled) return;
    let alive = true;
    setLoading(true);
    const h = setTimeout(() => {
      loadRef.current(q.trim())
        .then((o) => { if (alive) { setOpts(o); setErr(''); } })
        .catch((e) => { if (alive) { setOpts([]); setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('picker.loadFailed')); } })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, disabled, t, ...deps]);

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  const typed = q.trim();
  const current = opts.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">
          <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground', mono && 'font-mono')}>
            {value ? (display ?? (current?.sub ? `${current.label} · ${current.sub}` : value)) : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent inPlace className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('picker.search')}
            className="h-9 flex-1 bg-transparent text-sm outline-none" aria-label={t('picker.search')}
            onKeyDown={(e) => { if (e.key === 'Enter' && typed) { e.preventDefault(); pick(opts[0]?.value ?? typed); } }} />
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {err && <p className="px-2 py-1.5 text-xs text-destructive">{err}</p>}
          {!loading && !err && opts.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('picker.none')}</p>}
          {opts.map((o) => (
            <button key={o.value} type="button" onClick={() => pick(o.value)} title={o.sub ? `${o.label} · ${o.sub}` : o.label}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
              <Check className={cn('h-3.5 w-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
              <span className={cn('min-w-0 truncate', mono && 'font-mono')}>{o.label}</span>
              {o.sub && <span className="ml-auto truncate text-xs text-muted-foreground">{o.sub}</span>}
            </button>
          ))}
          {!loading && hint?.(opts, typed) && <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{hint(opts, typed)}</p>}
          {typed && !opts.some((o) => o.value === typed) && (
            <button type="button" onClick={() => pick(typed)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">
              <span className="h-3.5 w-3.5" />{t('picker.useTyped', { value: typed })}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
