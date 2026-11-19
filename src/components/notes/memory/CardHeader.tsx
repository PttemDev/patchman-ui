import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAutoGrow } from '@/hooks/useAutoGrow';
import { notesAPI } from '@/services/api';
import { useNotesStore } from '@/stores/notesStore';
import type { Note } from '@/types';
import { cn } from '@/lib/utils';
import { SourceBadge } from './MemoryBits';

// CardHeader sits under a knowledge card's title: its one-line summary
// (what recall shows instead of the body), who wrote it, how sure they were,
// and — for an outdated card — what replaced it.
export function CardHeader({ note, canEdit, onOpen, onChanged }: {
  note: Note;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChanged: (patch: Partial<Note>) => void;
}) {
  const { t } = useTranslation('notes');
  const { toast } = useToast();
  const [summary, setSummary] = useState(note.summary ?? '');
  useEffect(() => { setSummary(note.summary ?? ''); }, [note.summary]);
  const { ref: growRef } = useAutoGrow(summary, 1);
  const replacement = useNotesStore((s) => [...s.notes, ...s.shared].find((n) => n.id === note.supersededBy));

  const saveSummary = async () => {
    const v = summary.trim();
    if (v === (note.summary ?? '')) return;
    try {
      await notesAPI.update(note.id, { summary: v });
      onChanged({ summary: v });
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast({ title: t('memory.summarySaveFailed'), description: msg, variant: 'destructive' });
      setSummary(note.summary ?? '');
    }
  };

  const markCurrent = async () => {
    try {
      await notesAPI.update(note.id, { stale: false });
      onChanged({ stale: false, supersededBy: null });
    } catch {
      toast({ title: t('memory.saveFailed'), variant: 'destructive' });
    }
  };

  const verify = async () => {
    try {
      await notesAPI.update(note.id, { evidence: 'verified' });
      onChanged({ evidence: 'verified', confidence: 1 });
    } catch {
      toast({ title: t('memory.saveFailed'), variant: 'destructive' });
    }
  };

  // A rating is what the writer stated: an evidence value, or a confidence
  // other than 1 (a person's card) and 0.8 (an agent card that said nothing —
  // that used to show as a meaningless "80%").
  const conf = typeof note.confidence === 'number' ? note.confidence : undefined;
  const rated = !!note.evidence || (conf !== undefined && conf > 0 && conf < 1 && conf !== 0.8);
  const pct = rated && conf !== undefined && conf < 1 ? Math.round(conf * 100) : null;
  const isAgent = note.source === 'agent';
  return (
    <div className="mt-2 space-y-2">
      {note.stale && (
        <div className="flex items-center gap-2 flex-wrap rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
          <History className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span>{t('memory.staleBanner')}</span>
          {note.supersededBy && (
            <button type="button" className="underline text-primary" onClick={() => onOpen(note.supersededBy!)}>
              {t('memory.supersededBy', { title: replacement?.title ?? t('memory.newerCard') })}
            </button>
          )}
          {canEdit && <Button size="sm" variant="outline" className="h-6 ml-auto text-[11px]" onClick={() => void markCurrent()}>{t('memory.markCurrent')}</Button>}
        </div>
      )}
      {canEdit ? (
        // A wrapping, self-sizing textarea rather than an <input>: a 200-char
        // summary must be readable in full, not scrolled sideways. It stays
        // one paragraph — Enter saves, pasted line breaks become spaces.
        <textarea
          ref={growRef}
          rows={1}
          value={summary}
          onChange={(e) => setSummary(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
          onBlur={() => void saveSummary()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          maxLength={200}
          placeholder={t('memory.summaryPlaceholder')}
          className="block w-full resize-none overflow-hidden break-words bg-transparent text-sm text-muted-foreground italic outline-none placeholder:text-muted-foreground/50 border-b border-transparent focus:border-border"
          aria-label={t('memory.summary')}
        />
      ) : (
        note.summary && <p className="text-sm text-muted-foreground italic break-words">{note.summary}</p>
      )}
      <div className="flex items-center gap-1.5">
        <SourceBadge source={note.source} agent={note.agent} />
        {isAgent && (rated ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              note.evidence === 'verified' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : note.evidence === 'hearsay' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'bg-muted text-muted-foreground',
            )}
            title={t('memory.ratingHint')}
          >
            {note.evidence ? t(`memory.evidence.${note.evidence}`) : t('memory.confidenceOnly')}
            {pct !== null && ` · ${pct}%`}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground" title={t('memory.ratingHint')}>{t('memory.unrated')}</span>
        ))}
        {(note.importance === 'core' || note.importance === 'detail') && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t(`memory.importance.${note.importance}`)}</span>
        )}
        {canEdit && isAgent && note.evidence !== 'verified' && (
          <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[11px]" onClick={() => void verify()} title={t('memory.verifyHint')}>
            <BadgeCheck className="h-3.5 w-3.5" /> {t('memory.verify')}
          </Button>
        )}
      </div>
    </div>
  );
}
