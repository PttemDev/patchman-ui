import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookText } from 'lucide-react';
import { notesAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { openNoteTab } from './useOpenNote';

interface Linked { id: string; title: string; icon?: string; type: string; summary?: string; stale?: boolean; linkType: string }

// EntityNotes is the small "Notes" strip on a PatchMan item (a saved request,
// a K8s resource): the notes and memory cards that refer to it, one click to
// open. Renders nothing when there are none.
export function EntityNotes({ uri, className }: { uri: string; className?: string }) {
  const { t } = useTranslation('notes');
  const [items, setItems] = useState<Linked[]>([]);

  useEffect(() => {
    let live = true;
    const load = () => notesAPI.linksByUri(uri)
      .then((r) => { if (live) setItems((r.data as Linked[]) ?? []); })
      .catch(() => { if (live) setItems([]); });
    void load();
    const onEvent = () => { void load(); };
    window.addEventListener('patchman:note-event', onEvent);
    return () => { live = false; window.removeEventListener('patchman:note-event', onEvent); };
  }, [uri]);

  if (items.length === 0) return null;
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap text-xs', className)}>
      <span className="flex items-center gap-1 text-muted-foreground shrink-0" title={t('memory.entityNotesHint')}>
        <NotebookText className="h-3.5 w-3.5 text-sky-500" /> {t('memory.entityNotes')}
      </span>
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => openNoteTab(n.id, n.title)}
          title={n.summary || n.title}
          className={cn('border rounded-full px-2 py-0.5 hover:bg-accent/50 truncate max-w-[240px]', n.stale && 'opacity-60 line-through')}
        >
          {n.icon ? `${n.icon} ` : ''}{n.title}
        </button>
      ))}
    </div>
  );
}
