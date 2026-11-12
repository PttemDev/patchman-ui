import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAutoGrow } from '@/hooks/useAutoGrow';
import { notesAPI } from '@/services/api';
import { useNotesStore } from '@/stores/notesStore';
import type { Note } from '@/types';
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

  const confidence = typeof note.confidence === 'number' && note.confidence > 0 && note.confidence < 1 ? Math.round(note.confidence * 100) : null;
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
        {confidence !== null && <span className="text-[10px] text-muted-foreground">{t('memory.confidence', { pct: confidence })}</span>}
      </div>
    </div>
  );
}
