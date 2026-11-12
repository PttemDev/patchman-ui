import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GrafanaVariable } from '@/types';

// One dashboard variable control, Grafana-style: a dropdown with search for
// options (checkboxes when multi) and a custom-value field. Only textbox
// variables are a plain input. When the backend couldn't list a variable's
// values (unsupported datasource, query error) the dropdown still opens:
// it says why, offers the dashboard's saved values + All, and accepts a
// typed value.
export function VariablePicker({ v: raw, onChange }: { v: GrafanaVariable; onChange: (values: string[]) => void }) {
  const { t } = useTranslation('grafana');
  // A backend may send null for empty lists (a regex that matched nothing).
  const v = useMemo<GrafanaVariable>(() => ({
    ...raw,
    options: raw.options ?? [],
    current: { ...(raw.current ?? { values: [] }), values: raw.current?.values ?? [], texts: raw.current?.texts ?? [] },
  }), [raw]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');
  const [draft, setDraft] = useState<string[]>(v.current.values);
  const [text, setText] = useState(v.current.values.join(','));

  const currentKey = v.current.values.join('\u0000');
  useEffect(() => {
    setDraft(currentKey ? currentKey.split('\u0000') : []);
    setText(currentKey.split('\u0000').join(','));
  }, [currentKey]);

  const allText = t('vars.all');
  // Options as shown: All first when the variable has it, then the listed /
  // saved values, then any current value the list doesn't know (custom).
  const options = useMemo(() => {
    const list = [...v.options];
    if (v.includeAll && !list.some((o) => o.value === '$__all')) list.unshift({ text: 'All', value: '$__all' });
    for (const val of v.current.values) {
      if (val && !list.some((o) => o.value === val)) list.push({ text: val, value: val });
    }
    return list.map((o) => (o.value === '$__all' ? { ...o, text: allText } : o));
  }, [v, allText]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => o.text.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : options;
    return list.slice(0, 500);
  }, [q, options]);

  const label = v.label || v.name;
  const shown = v.current.values.map((val, i) => (val === '$__all' ? allText : (v.current.texts?.[i] && v.current.texts[i] !== '$__all' ? v.current.texts[i] : val))).join(' + ') || '—';
  const unlisted = v.free || !!v.error;

  if (v.type === 'textbox') {
    return (
      <div className="flex items-center h-7 rounded-md border overflow-hidden text-xs">
        {v.hide !== 1 && <span className="px-2 bg-muted/50 h-full flex items-center text-muted-foreground border-r">{label}</span>}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== v.current.values.join(',') && onChange(text === '' ? [''] : [text])}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="h-full px-2 bg-transparent outline-none w-36 font-mono"
        />
        {v.error && <span title={v.error} className="px-1 text-amber-500"><AlertTriangle className="h-3 w-3" /></span>}
      </div>
    );
  }

  const toggle = (value: string) => {
    if (!v.multi) {
      onChange([value]);
      setOpen(false);
      return;
    }
    if (value === '$__all') {
      setDraft(['$__all']);
      return;
    }
    setDraft((d) => {
      const base = d.filter((x) => x !== '$__all');
      const next = base.includes(value) ? base.filter((x) => x !== value) : [...base, value];
      return next.length ? next : (v.includeAll ? ['$__all'] : [value]);
    });
  };

  const addCustom = () => {
    const val = custom.trim();
    if (!val) return;
    setCustom('');
    if (!v.multi) {
      onChange([val]);
      setOpen(false);
      return;
    }
    setDraft((d) => [...d.filter((x) => x !== '$__all' && x !== val), val]);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && v.multi && draft.join('\u0000') !== v.current.values.join('\u0000')) onChange(draft);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center h-7 rounded-md border overflow-hidden text-xs hover:bg-accent/30 max-w-[320px]">
          {v.hide !== 1 && <span className="px-2 bg-muted/50 h-full flex items-center text-muted-foreground border-r shrink-0">{label}</span>}
          <span className="px-2 truncate">{shown}</span>
          {unlisted && <span title={v.error || t('vars.cantList')} className="pr-1 text-amber-500 shrink-0"><AlertTriangle className="h-3 w-3" /></span>}
          <ChevronDown className="h-3 w-3 mr-1.5 opacity-60 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {unlisted && (
          <div className="px-3 py-2 border-b bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300 flex gap-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div>{t('vars.cantList')}</div>
              {v.error && <div className="mt-0.5 text-[10px] opacity-80 break-words line-clamp-4" title={v.error}>{v.error}</div>}
            </div>
          </div>
        )}
        <div className="p-2 border-b">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('vars.search')} className="h-7 text-xs" />
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{t('vars.noOptions')}</div>}
          {filtered.map((o) => {
            const sel = (v.multi ? draft : v.current.values).includes(o.value);
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)} className={cn('w-full flex items-center gap-2 px-3 py-1 text-xs text-left hover:bg-accent', sel && 'font-medium')}>
                <span className={cn('h-3.5 w-3.5 shrink-0 flex items-center justify-center', v.multi && 'rounded-sm border')}>
                  {sel && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate" title={o.value}>{o.text}</span>
              </button>
            );
          })}
        </div>
        <div className="p-2 border-t flex items-center gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            placeholder={t('vars.customValue')}
            className="h-7 text-xs flex-1 font-mono"
          />
          {v.multi && (
            <Button size="sm" className="h-7 text-xs" onClick={() => { const next = custom.trim() ? [...draft.filter((x) => x !== '$__all'), custom.trim()] : draft; setCustom(''); onChange(next); setOpen(false); }}>{t('vars.apply')}</Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
