import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Lightbulb, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ES_CHEATSHEET, ES_TIPS, type ESCheatEntry } from './esCheatsheetData';

interface ESCheatsheetProps {
  onInsert: (snippet: string) => void;
  onClose: () => void;
}

// A cookbook-style left panel mirroring the Redis cheatsheet: a short primer
// plus grouped, filterable Kibana-console recipes. Clicking a recipe inserts
// its full `METHOD path` + body block into the console editor.
export function ESCheatsheet({ onInsert, onClose }: ESCheatsheetProps) {
  const { t } = useTranslation('es');
  const [filter, setFilter] = useState('');
  const [showTips, setShowTips] = useState(true);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ES_CHEATSHEET;
    return ES_CHEATSHEET.map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) =>
          e.cmd.toLowerCase().includes(q) ||
          e.desc.toLowerCase().includes(q) ||
          e.syntax.toLowerCase().includes(q),
      ),
    })).filter((g) => g.entries.length > 0);
  }, [filter]);

  return (
    <div className="w-80 shrink-0 border-r flex flex-col min-h-0 bg-muted/20">
      <div className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('cheatsheet.title')}
        </span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose} title={t('cheatsheet.close')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('cheatsheet.filter')}
            className="h-8 text-xs pl-7"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 space-y-3">
        {!filter && (
          <div className="rounded-md border bg-background/40">
            <button
              type="button"
              onClick={() => setShowTips((s) => !s)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400"
            >
              <Lightbulb className="h-3.5 w-3.5 shrink-0" />
              {t('cheatsheet.howTo')}
              <ChevronRight className={cn('h-3 w-3 ml-auto transition-transform', showTips && 'rotate-90')} />
            </button>
            {showTips && (
              <div className="px-2.5 pb-2 space-y-2">
                {ES_TIPS.map((tip) => (
                  <div key={tip.title}>
                    <p className="text-[11px] font-medium text-foreground/90">{tip.title}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{tip.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.id}>
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {g.label}
            </p>
            <div className="space-y-0.5">
              {g.entries.map((e) => (
                <CheatRow key={e.cmd} entry={e} onInsert={onInsert} />
              ))}
            </div>
          </div>
        ))}

        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">{t('cheatsheet.noMatch', { filter })}</p>
        )}
      </div>
    </div>
  );
}

function CheatRow({ entry, onInsert }: { entry: ESCheatEntry; onInsert: (s: string) => void }) {
  const { t } = useTranslation('es');
  return (
    <button
      type="button"
      onClick={() => onInsert(entry.example)}
      title={`${entry.syntax}\n\n${t('cheatsheet.insertLabel')}\n${entry.example}`}
      className="group w-full text-left rounded px-2 py-1 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-primary">{entry.cmd}</span>
        {entry.write && (
          <span className="text-[8px] uppercase tracking-wide text-amber-500 border border-amber-500/40 rounded px-1 leading-tight">
            {t('cheatsheet.write')}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground truncate group-hover:text-foreground/80">
        {entry.desc}
      </p>
    </button>
  );
}
