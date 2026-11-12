import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderTree, OctagonX, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { NamespaceInfo } from './serviceMapUtil';

// Client-side namespace scope for the map: tick the namespaces to look at;
// whatever they talk to elsewhere stays on the map, faded, as context.
export function NamespacePicker({ namespaces, selected, onChange }: {
  namespaces: NamespaceInfo[];
  /** Empty = every namespace. */
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation('servicemap');
  const [q, setQ] = useState('');
  const all = selected.length === 0;
  const chosen = useMemo(() => new Set(selected), [selected]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? namespaces.filter((n) => (n.namespace || t('ns.outside')).toLowerCase().includes(s)) : namespaces;
  }, [namespaces, q, t]);
  const name = (ns: string) => ns || t('ns.outside');

  const toggle = (ns: string) => {
    const base = all ? namespaces.map((n) => n.namespace) : selected;
    const next = base.includes(ns) ? base.filter((x) => x !== ns) : [...base, ns];
    onChange(next.length === namespaces.length ? [] : next);
  };

  return (
    <Popover onOpenChange={(o) => { if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('h-7 text-xs', !all && 'text-primary')} title={t('ns.contextHint')}>
          <FolderTree className="h-3.5 w-3.5 mr-1" />
          {t('toolbar.namespaces')}
          <span className="ml-1 font-mono tabular-nums opacity-70">{all ? namespaces.length : `${selected.length}/${namespaces.length}`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b p-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ns.search')} className="h-7 pl-7 text-xs" />
          </div>
          <button type="button" onClick={() => onChange([])}
            className={cn('w-full rounded-md px-2 py-1 text-left text-xs', all ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50')}>
            {t('ns.all')}
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {list.map((n) => {
            const on = all || chosen.has(n.namespace);
            return (
              <div key={n.namespace || '~'} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
                <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={on} onChange={() => toggle(n.namespace)} aria-label={name(n.namespace)} />
                <button type="button" onClick={() => toggle(n.namespace)} className={cn('flex-1 truncate text-left text-xs', !n.namespace && 'italic')}>
                  {name(n.namespace)}
                </button>
                {n.critical > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-[var(--sm-crit)]" title={t('health.critical')}>
                    <OctagonX className="h-3 w-3" />{n.critical}
                  </span>
                )}
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{n.nodes}</span>
                <button type="button" onClick={() => onChange([n.namespace])}
                  className="hidden group-hover:inline rounded px-1 text-[10px] text-primary hover:underline">
                  {t('ns.only')}
                </button>
              </div>
            );
          })}
        </div>
        <p className="border-t px-3 py-2 text-[10px] text-muted-foreground">{t('ns.contextHint')}</p>
      </PopoverContent>
    </Popover>
  );
}
